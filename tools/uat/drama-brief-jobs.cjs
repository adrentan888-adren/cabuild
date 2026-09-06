const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const crypto = require('node:crypto');
function loadTs(file, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require, Response, Request, URL, Error, Date, AbortSignal, console, process, ...globals }, { filename: file });
  return module.exports;
}
(async () => {
  const objects = new Map();
  let failStorage = false;
  const mockFetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'metadata.google.internal') return Response.json({ access_token: 'fixture-storage-token' });
    assert.equal(url.hostname, 'storage.googleapis.com', 'No external provider calls allowed');
    if (failStorage) return Response.json({}, { status: 503 });
    if (options.method === 'POST') {
      assert.equal(url.searchParams.get('ifGenerationMatch'), '0', 'Every write must be atomic create-only');
      const name = url.searchParams.get('name');
      if (objects.has(name)) return Response.json({}, { status: 412 });
      objects.set(name, JSON.parse(options.body));
      return Response.json({ name });
    }
    const encoded = url.pathname.split('/o/')[1];
    if (encoded) {
      const object = objects.get(decodeURIComponent(encoded));
      return object ? Response.json(object) : Response.json({}, { status: 404 });
    }
    const names = [...objects.keys()].filter(name => name.startsWith(url.searchParams.get('prefix')));
    const offset = Number(url.searchParams.get('pageToken') || 0);
    return Response.json({ items: names.slice(offset, offset + 2).map(name => ({ name })), ...(offset + 2 < names.length ? { nextPageToken: String(offset + 2) } : {}) });
  };
  const storage = loadTs('lib/drama/brief-jobs.ts', { process: { env: { DATA_STORE_GCS_BUCKET: 'fixture', DATA_STORE_GCS_OBJECT: 'fixture-app.json' }, cwd: () => process.cwd() }, fetch: mockFetch });
  let owner = 'owner-a', calls = 0, resolveProvider;
  let mode = 'waiting';
  const longError = 'Full provider failure message. '.repeat(40) + 'THE END';
  const route = loadTs('app/api/drama/brief-jobs/route.ts', { require: name => {
    if (name === '@/lib/session') return { currentUser: async () => owner ? { id: owner } : null };
    if (name === '@/lib/drama/brief-jobs') return storage;
    if (name === '@/lib/drama/read-response') return loadTs('lib/drama/read-response.ts');
    if (name === '../generate/stage/route') return { POST: async request => {
      calls++;
      const payload = await request.json();
      assert.equal(new URL(request.url).pathname, '/api/drama/generate/stage');
      assert.equal(payload.targetStage, 1);
      assert.equal(payload.snapshot.continuity, 'Flexible');
      if (mode === 'waiting') await new Promise(resolve => { resolveProvider = resolve; });
      if (mode === 'failure') return Response.json({ ok: false, message: longError }, { status: 502 });
      return Response.json({ ok: true, result: { brief: 'A finished creative brief.' } });
    } };
    return require(name);
  } });
  const input = { id: crypto.randomUUID(), model: 'gemini-2.5-flash', snapshot: { roughStory: 'A rough story', continuity: 'Flexible', tone: ['Mystery'], episodes: 6 } };
  const request = body => new Request('http://local/api/drama/brief-jobs', { method: 'POST', body: JSON.stringify(body) });
  const first = route.POST(request(input));
  while (!resolveProvider) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  let response = await route.GET(); let jobs = (await response.json()).jobs;
  assert.equal(jobs[0].status, 'generating'); assert.equal(jobs[0].snapshot.episodes, 6);
  response = await route.POST(request(input)); assert.equal(response.status, 202); assert.equal(calls, 1);
  response = await route.DELETE(new Request(`http://local/api/drama/brief-jobs?id=${input.id}`, { method: 'DELETE' })); assert.equal(response.status, 409);
  owner = 'owner-b'; response = await route.GET(); assert.equal((await response.json()).jobs.length, 0); owner = 'owner-a';
  resolveProvider(); response = await first; let job = (await response.json()).job;
  assert.equal(job.status, 'ready'); assert.equal(job.snapshot.generatedBrief, 'A finished creative brief.');
  assert.equal((await (await route.GET()).json()).jobs[0].status, 'ready', 'Completion survives independent GET');
  response = await route.POST(request(input)); assert.equal(response.status, 200); assert.equal(calls, 1);
  mode = 'failure'; const failedInput = { ...input, id: crypto.randomUUID() };
  job = (await (await route.POST(request(failedInput))).json()).job; assert.equal(job.status, 'failed'); assert.equal(job.error, longError);
  response = await route.DELETE(new Request(`http://local/api/drama/brief-jobs?id=${input.id}`, { method: 'DELETE' })); assert.equal(response.status, 200);
  response = await route.GET(); assert.equal((await response.json()).jobs.length, 1, 'Deleted records do not return in polling');
  response = await route.POST(request(input)); assert.equal(response.status, 410); assert.equal(calls, 2, 'Deleted request never spends again');
  const expired = { ...job, id: crypto.randomUUID(), status: 'generating', createdAt: new Date(Date.now() - 301000).toISOString() }; delete expired.error; delete expired.finishedAt;
  await storage.claimBriefJob(owner, expired);
  job = await storage.getBriefJob(owner, expired.id); assert.equal(job.status, 'failed'); assert.match(job.error, /No automatic retry/); assert.equal(calls, 2);
  const concurrent = { ...expired, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const claims = await Promise.all([storage.claimBriefJob(owner, concurrent), storage.claimBriefJob(owner, concurrent)]); assert.equal(claims.filter(item => item.claimed).length, 1);
  owner = null; assert.equal((await route.GET()).status, 401); assert.equal((await route.POST(request(input))).status, 401); assert.equal((await route.DELETE(new Request('http://local/api/drama/brief-jobs?id=' + input.id))).status, 401); owner = 'owner-a';
  assert.equal((await route.POST(request({ ...input, id: '../../escape' }))).status, 400);
  assert.equal((await route.POST(request({ ...input, model: 'unknown' }))).status, 400);
  assert.equal((await route.POST(request(null))).status, 400);
  failStorage = true;
  const before = calls; assert.equal((await route.POST(request({ ...input, id: crypto.randomUUID() }))).status, 503); assert.equal(calls, before, 'Storage unavailable must prevent provider spend');
  assert.equal((await route.GET()).status, 503);
  const path = require('node:path');
  const fixtureRoot = path.resolve('.playwright-mcp', 'brief-job-storage-' + crypto.randomUUID());
  assert.ok(fixtureRoot.startsWith(path.resolve('.playwright-mcp') + path.sep));
  fs.mkdirSync(fixtureRoot, { recursive: true });
  try {
    const local = loadTs('lib/drama/brief-jobs.ts', { process: { env: {}, cwd: () => fixtureRoot } });
    const pending = { ...concurrent, id: crypto.randomUUID() };
    const localClaims = await Promise.all([local.claimBriefJob('local-owner', pending), local.claimBriefJob('local-owner', pending)]);
    assert.equal(localClaims.filter(item => item.claimed).length, 1);
    assert.equal((await local.listBriefJobs('local-owner'))[0].status, 'generating');
    await local.finishBriefJob('local-owner', { ...pending, status: 'ready', snapshot: { ...pending.snapshot, generatedBrief: 'Stored on disk.' } });
    assert.equal((await local.getBriefJob('local-owner', pending.id)).snapshot.generatedBrief, 'Stored on disk.');
    assert.equal((await local.listBriefJobs('another-owner')).length, 0);
    assert.equal(await local.deleteBriefJob('local-owner', pending.id), 'deleted');
    assert.equal((await local.listBriefJobs('local-owner')).length, 0);
    assert.equal((await local.claimBriefJob('local-owner', pending)).claimed, false);
  } finally { fs.rmSync(fixtureRoot, { recursive: true }); }
  console.log('PASS durable brief jobs: immediate pending, stored completion/failure, complete errors, owner isolation, concurrent claims, replay/no duplicate spend, expiry/no retry, delete/tombstone, paginated storage, auth/input validation, storage failure blocks provider. All provider and GCS requests mocked.');
})().catch(error => { console.error(error); process.exit(1); });
