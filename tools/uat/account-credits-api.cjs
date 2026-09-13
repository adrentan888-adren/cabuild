const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

(async () => {
  let signedIn = true, workspaceId = 'workspace-a', configured = true;
  let kie = { code: 200, data: 0 };
  let apify = { data: { limits: { maxMonthlyUsageUsd: 0 }, current: { monthlyUsageUsd: 0 } } };
  let status = 200, nonJson = false, fetches = 0, dbReads = 0, keyReads = 0;
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('app/api/account/credits/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Response, Date, console,
    require: name => {
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/lib/session') return { currentUser: async () => signedIn ? { id: `owner-${workspaceId}`, workspaceId, name: 'Fixture owner', email: 'fixture@example.test', role: 'owner' } : null };
      if (name === '@/lib/store') return { readDb: async () => {
        dbReads++;
        return { workspaces: [{ id: 'workspace-a', name: 'Workspace A', plan: 'Pro', credits: 111 }, { id: 'workspace-b', name: 'Workspace B', plan: 'Starter', credits: 222 }] };
      } };
      if (name === '@/lib/apiKeyOverrides') return {
        apiKeyStatus: async () => Object.fromEntries(['kie', 'apify', 'apifyBackup', 'uploadPost'].map(id => [id, { envConfigured: configured, overrideConfigured: false }])),
        getProviderApiKey: async () => { keyReads++; return 'no-spend-fixture-secret'; },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url, options) => {
      fetches++;
      assert.equal(options.method ?? 'GET', 'GET', 'Balance lookup cannot create paid work');
      assert.equal(options.cache, 'no-store');
      assert(['https://api.kie.ai/api/v1/chat/credit', 'https://api.apify.com/v2/users/me/limits'].includes(url), 'Only known read-only balance endpoints');
      if (nonJson) return new Response('Provider unavailable', { status: 503 });
      return { ok: status === 200, json: async () => url.includes('kie.ai') ? kie : apify };
    },
  }, { filename: 'account-credits-route.ts' });
  const get = async () => {
    const response = await module.exports.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.doesNotMatch(JSON.stringify(result), /no-spend-fixture-secret|Authorization/);
    return result;
  };
  const balances = result => Object.fromEntries(result.providers.map(provider => [provider.id, provider]));
  signedIn = false;
  assert.equal((await module.exports.GET()).status, 401);
  assert.equal(fetches, 0); assert.equal(dbReads, 0); assert.equal(keyReads, 0);
  signedIn = true;
  let result = await get();
  assert.equal(result.user.id, 'owner-workspace-a'); assert.equal(result.workspace.id, 'workspace-a'); assert.equal(result.workspace.credits, 111);
  assert.equal(balances(result).kie.credits, 0); assert.equal(balances(result).apify.credits, 0); assert.equal(balances(result).apifyBackup.credits, 0);
  workspaceId = 'workspace-b'; result = await get();
  assert.equal(result.user.id, 'owner-workspace-b'); assert.equal(result.workspace.id, 'workspace-b'); assert.equal(result.workspace.credits, 222);
  kie = { code: '200', data: '0' };
  apify = { data: { limits: { maxMonthlyUsageUsd: '50.00' }, current: { monthlyUsageUsd: '32.75' } } };
  result = balances(await get());
  assert.equal(result.kie.credits, 0); assert.equal(result.apify.credits, 17.25); assert.equal(result.apify.unit, 'USD');
  assert.equal(result.apify.message, '$32.75 of $50.00 used this cycle');
  kie.data = '987.5'; assert.equal(balances(await get()).kie.credits, 987.5);
  for (const invalid of [null, undefined, '', '  ', false, true, NaN, Infinity, -Infinity, 'Infinity', 'not a number', {}, []]) {
    kie.data = invalid;
    apify = { data: { limits: { maxMonthlyUsageUsd: 50 }, current: { monthlyUsageUsd: invalid } } };
    result = balances(await get());
    for (const id of ['kie', 'apify', 'apifyBackup']) {
      assert.equal(result[id].credits, null, `Invalid ${typeof invalid} value must not become a balance`);
      assert.equal(result[id].message, 'Balance temporarily unavailable');
    }
    apify = { data: { limits: { maxMonthlyUsageUsd: invalid }, current: { monthlyUsageUsd: 0 } } };
    assert.equal(balances(await get()).apify.credits, null, 'Invalid limit must not become zero allowance');
  }
  kie = { code: 200, data: 10 }; apify = { data: { limits: { maxMonthlyUsageUsd: 50 }, current: { monthlyUsageUsd: 60 } } };
  assert.equal(balances(await get()).apify.credits, 0, 'Over-limit usage has no remaining allowance');
  status = 503;
  result = balances(await get()); assert.equal(result.kie.credits, null); assert.equal(result.apify.credits, null);
  status = 200; nonJson = true;
  result = balances(await get()); assert.equal(result.kie.credits, null); assert.equal(result.apify.credits, null);
  nonJson = false; configured = false;
  const before = fetches; result = balances(await get());
  assert.equal(fetches, before, 'Unconfigured providers are never contacted');
  assert.equal(result.kie.credits, null); assert.equal(result.kie.configured, false);
  assert.equal(result.uploadPost.credits, null); assert.equal(result.uploadPost.unit, null);
  console.log('PASS actual account credit route: authentication, workspace identity isolation, no-store/no secrets, exact zero/numeric strings, null/blank/boolean/nonfinite rejection, HTTP/non-JSON unavailable states, unconfigured no calls; all provider calls mocked');
})().catch(error => { console.error(error); process.exit(1); });
