const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
function loadTs(file, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require, Response, Request, URL, Error, Date, AbortSignal, console, process, Buffer, structuredClone, ...globals }, { filename: file });
  return module.exports;
}
(async () => {
  const objects = new Map();
  let storageFailure = false;
  const storageFetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'metadata.google.internal') return Response.json({ access_token: 'fixture-storage-token' });
    assert.equal(url.hostname, 'storage.googleapis.com', 'No external calls allowed');
    if (storageFailure) return Response.json({}, { status: 503 });
    if (options.method === 'POST') {
      assert.equal(url.searchParams.get('ifGenerationMatch'), '0', 'Task and terminal writes must be atomic create-only');
      const name = url.searchParams.get('name');
      if (objects.has(name)) return Response.json({}, { status: 412 });
      objects.set(name, JSON.parse(options.body));
      return Response.json({ name });
    }
    const name = decodeURIComponent(url.pathname.split('/o/')[1]);
    return objects.has(name) ? Response.json(objects.get(name)) : Response.json({}, { status: 404 });
  };
  const storage = loadTs('lib/drama/media-tasks.ts', { process: { env: { DATA_STORE_GCS_BUCKET: 'fixture', DATA_STORE_GCS_OBJECT: 'fixture-app.json' }, cwd: () => process.cwd() }, fetch: storageFetch });
  const receiptEnv = { APP_SECRET: 'fixture-only-recovery-signing-secret' };
  let receiptClockOffset = 0;
  class ReceiptDate extends Date { static now() { return Date.now() + receiptClockOffset; } }
  const receipts = loadTs('lib/drama/media-receipt.ts', { process: { env: receiptEnv }, Date: ReceiptDate });
  let owner = 'workspace-a', signedIn = true, authFailure = false, missingKey = false, projectionFailure = false;
  let db = { assets: [], publishQueue: [], activity: [] }, creates = 0, checks = 0;
  const states = new Map();
  let deferredStatus = null;
  const route = loadTs('app/api/drama/generate/media/route.ts', { require: name => {
    if (name === '@/lib/session') return { currentUser: async () => { if (authFailure) throw new Error('Fixture auth unavailable'); return signedIn ? { id: 'user-a', workspaceId: owner } : null; } };
    if (name === '@/lib/apiKeyOverrides') return { getProviderApiKey: async () => missingKey ? '' : 'fixture-key' };
    if (name === '@/lib/drama/media-tasks') return storage;
    if (name === '@/lib/drama/media-receipt') return receipts;
    if (name === '@/lib/store') return { id: prefix => prefix + '-' + require('node:crypto').randomUUID(), readDb: async () => structuredClone(db), mutateDb: async fn => {
      if (projectionFailure) throw new Error('Fixture projection unavailable');
      // Deliberately reproduce production's stale whole-app write race.
      const copy = structuredClone(db); const value = await fn(copy);
      await new Promise(resolve => setImmediate(resolve)); db = copy; return value;
    } };
    return require(name);
  }, console: { warn: () => {} }, fetch: async (input, options = {}) => {
    const url = new URL(input); assert.equal(url.hostname, 'api.kie.ai', 'Only mocked Kie calls');
    if (url.pathname.endsWith('/createTask')) {
      creates++; const taskId = 'fixture-task-' + creates;
      states.set(taskId, { state: 'waiting', progress: 20 });
      return Response.json({ code: 200, msg: 'success', data: { taskId } });
    }
    checks++; const taskId = url.searchParams.get('taskId');
    if (deferredStatus?.taskId === taskId) { const deferred = deferredStatus; deferredStatus = null; await deferred.promise; return Response.json({ code: 200, data: { taskId, state: 'waiting' } }); }
    const state = states.get(taskId); assert.ok(state, 'Unknown ownership must not query provider');
    if (state.raw) return new Response(state.raw, { status: 500 });
    return Response.json({ code: state.code || 200, data: { taskId, model: 'seedream/4.5-text-to-image', ...state } }, { status: state.httpStatus || 200 });
  } });
  const post = input => route.POST(new Request('http://local/api/drama/generate/media', { method: 'POST', body: JSON.stringify(input) }));
  const get = (taskId, recoveryReceipt) => route.GET(new Request('http://local/api/drama/generate/media?taskId=' + encodeURIComponent(taskId), { headers: recoveryReceipt ? { 'X-Drama-Task-Receipt': recoveryReceipt } : {} }));
  const input = { kind: 'image', model: 'seedream-4.5', prompt: 'A red train crossing a bridge', title: 'Bridge', recordId: 'story-1', itemId: 'asset-1', aspectRatio: '9:16' };
  const submissions = await Promise.all(Array.from({ length: 8 }, () => post(input)));
  const tasks = await Promise.all(submissions.map(async response => { assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.diagnostic, undefined); assert.ok(body.recoveryReceipt); assert.ok(body.recoveryReceipt.length < 8192); return body; }));
  assert.equal(creates, 8); assert.ok(db.assets.length < 8, 'Fixture must reproduce lost shared-store rows');
  for (const task of tasks) assert.ok(await storage.getDramaMediaTask(owner, task.taskId), 'Each concurrent task remains durable');
  let responses = await Promise.all(tasks.map(task => get(task.taskId)));
  for (const response of responses) { assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.state, 'waiting'); assert.equal(body.diagnostic, undefined); }
  const before = checks; owner = 'workspace-b'; assert.equal((await get(tasks[0].taskId)).status, 404); owner = 'workspace-a'; assert.equal((await get('unknown-task')).status, 404); assert.equal(checks, before, 'Unknown and cross-workspace task IDs never reach provider');
  const first = tasks[0]; states.set(first.taskId, { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://fixture.invalid/first.png'] }) });
  let response = await get(first.taskId); let body = await response.json(); assert.equal(body.state, 'success'); assert.equal(body.diagnostic, undefined);
  const completedChecks = checks; db.assets = []; db.publishQueue = []; missingKey = true;
  body = await (await get(first.taskId)).json(); assert.equal(body.state, 'success'); assert.equal(checks, completedChecks, 'Cached completion survives lost app rows without key/provider'); assert.equal(db.assets[0].assetUrl, 'https://fixture.invalid/first.png'); missingKey = false;
  const failed = tasks[1], longError = 'Provider could not render this image. '.repeat(70) + 'FULL END';
  states.set(failed.taskId, { state: 'fail', failMsg: longError, failCode: 'RENDER' });
  body = await (await get(failed.taskId)).json(); assert.equal(body.state, 'fail'); assert.equal(body.message, longError); assert.ok(body.diagnostic);
  const failedChecks = checks; body = await (await get(failed.taskId)).json(); assert.equal(body.message, longError); assert.equal(checks, failedChecks);
  // A delayed pending response cannot undo the concurrently saved terminal result.
  let release; const delayed = tasks[2]; deferredStatus = { taskId: delayed.taskId, promise: new Promise(resolve => release = resolve) };
  const pending = get(delayed.taskId); while (deferredStatus) await new Promise(resolve => setImmediate(resolve));
  states.set(delayed.taskId, { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://fixture.invalid/delayed.png'] }) });
  assert.equal((await (await get(delayed.taskId)).json()).state, 'success'); release(); assert.equal((await (await pending).json()).state, 'success');
  // Legacy recovery accepts only existing owned server records, including a queue-only survivor.
  db.assets = [{ id: 'legacy-asset', workspaceId: owner, provider: 'kie', providerTaskId: 'legacy', title: 'Legacy', type: 'image', status: 'rendering', progress: 10, createdAt: new Date().toISOString(), briefId: 'story-1' }]; db.publishQueue = [];
  states.set('legacy', { state: 'waiting' }); assert.equal((await get('legacy')).status, 200); assert.ok(await storage.getDramaMediaTask(owner, 'legacy'));
  db.assets = []; db.publishQueue = [{ id: 'legacy-pub', workspaceId: owner, assetId: 'queue-only-asset', provider: 'kie', providerRequestId: 'queue-only', title: 'Queue only', platform: 'TikTok', status: 'generating', scheduledAt: new Date().toISOString(), generationType: 'image' }];
  states.set('queue-only', { state: 'waiting' }); assert.equal((await get('queue-only')).status, 200); assert.equal(db.assets[0].id, 'queue-only-asset');
  projectionFailure = true; const accepted = await (await post(input)).json(); assert.ok(accepted.taskId); assert.ok(await storage.getDramaMediaTask(owner, accepted.taskId)); assert.equal((await get(accepted.taskId)).status, 200); projectionFailure = false;
  const storageChecks = checks; storageFailure = true; assert.equal((await get(tasks[3].taskId)).status, 503); assert.equal(checks, storageChecks); response = await post(input); assert.equal(response.status, 503); body = await response.json(); assert.ok(body.taskId); assert.match(body.message, /accepted/); storageFailure = false;
  const storagePending = body, acceptedCreates = creates;
  assert.equal(storagePending.accepted, true); assert.equal(storagePending.storagePending, true); assert.equal(storagePending.state, 'waiting'); assert.ok(storagePending.recoveryReceipt);
  const receiptTaskId = storagePending.taskId, receipt = storagePending.recoveryReceipt;
  const checksBeforeInvalidReceipt = checks;
  assert.equal((await get(receiptTaskId)).status, 404);
  const tampered = (receipt[0] === 'A' ? 'B' : 'A') + receipt.slice(1);
  assert.equal((await get(receiptTaskId, tampered)).status, 404);
  assert.equal((await get(receiptTaskId, 'a'.repeat(8200))).status, 404);
  owner = 'workspace-b'; assert.equal((await get(receiptTaskId, receipt)).status, 404); owner = 'workspace-a';
  assert.equal((await get('different-receipt-task', receipt)).status, 404);
  receiptClockOffset = 8 * 24 * 60 * 60 * 1000; assert.equal((await get(receiptTaskId, receipt)).status, 404); receiptClockOffset = 0;
  assert.equal(checks, checksBeforeInvalidReceipt, 'Tampered, oversized, cross-workspace, task-mismatched and expired receipts cannot reach provider');
  states.set(receiptTaskId, { state: 'generating', progress: 45 });
  response = await get(receiptTaskId, receipt); assert.equal(response.status, 200); body = await response.json(); assert.equal(body.state, 'generating');
  const repaired = await storage.getDramaMediaTask(owner, receiptTaskId); assert.equal(repaired.asset.id, storagePending.assetId); assert.equal(repaired.publishItem.id, storagePending.publishItemId); assert.equal(repaired.asset.generationSettings.dramaRecordId, 'story-1'); assert.equal(repaired.asset.generationSettings.aspectRatio, '9:16');
  states.set(receiptTaskId, { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://fixture.invalid/recovered.png'] }) });
  assert.equal((await (await get(receiptTaskId)).json()).state, 'success'); assert.equal(creates, acceptedCreates, 'Accepted storage failure recovers through GET without another paid POST');
  const savedSecret = receiptEnv.APP_SECRET; receiptEnv.APP_SECRET = ''; assert.equal((await post(input)).status, 503); assert.equal(creates, acceptedCreates, 'Missing signing secret fails before provider submission'); receiptEnv.APP_SECRET = savedSecret;
  states.set(tasks[3].taskId, { state: 'success', resultJson: '{}' }); body = await (await get(tasks[3].taskId)).json(); assert.equal(body.state, 'generating'); assert.equal(body.progress, 99); assert.equal(body.error, undefined); assert.equal(body.diagnostic, undefined); assert.equal(await storage.getDramaMediaResult(owner, tasks[3].taskId), null, 'Missing output stays pending until the URL materializes');
  states.set(tasks[3].taskId, { raw: 'Internal Server Error' }); assert.equal((await get(tasks[3].taskId)).status, 502);
  const creationsBeforeTransientStatus = creates;
  for (const transient of [
    { httpStatus: 429, code: 429, expected: 429 },
    { httpStatus: 200, code: 429, expected: 429 },
    { httpStatus: 200, code: 500, expected: 502 },
    { httpStatus: 503, code: 503, expected: 502 },
  ]) {
    states.set(tasks[3].taskId, { state: 'waiting', ...transient });
    response = await get(tasks[3].taskId); assert.equal(response.status, transient.expected);
    assert.equal(await storage.getDramaMediaResult(owner, tasks[3].taskId), null, 'Transient provider failure must not finalize an owned task');
    states.set(tasks[3].taskId, { state: 'generating', progress: 65 });
    response = await get(tasks[3].taskId); body = await response.json(); assert.equal(response.status, 200); assert.equal(body.state, 'generating'); assert.equal(body.diagnostic, undefined);
    assert.equal(creates, creationsBeforeTransientStatus, 'Status recovery must not resubmit the provider job');
  }
  states.set(tasks[3].taskId, { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://fixture.invalid/later.png'] }) }); assert.equal((await (await get(tasks[3].taskId)).json()).state, 'success');
  signedIn = false; assert.equal((await get(first.taskId)).status, 401); assert.equal((await post(input)).status, 401); signedIn = true;
  authFailure = true; assert.equal((await get(first.taskId)).status, 503); assert.equal((await post(input)).status, 503); authFailure = false;
  assert.equal((await post(null)).status, 400); assert.equal((await get('')).status, 400);
  assert.equal(creates, 10, 'No hidden create retry from polling/storage failures');
  console.log('PASS Drama media recovery: 8 concurrent lost-row tasks, owner isolation, unknown rejection, legacy asset/queue recovery, pending/success/failure, full errors, immutable completion vs late pending, cached refresh/no key, storage fail-closed, deferred projection, malformed provider output, retryable HTTP/code429 and upstream5xx recovery, signed receipt persistence repair/replay rejection, auth, no automatic provider retries; all calls mocked.');
})().catch(error => { console.error(error); process.exit(1); });
