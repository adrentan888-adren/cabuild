const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

function loadTs(path, globals) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require, Response, Request, Error, DOMException, console, ...globals }, { filename: path });
  return module.exports;
}

(async () => {
  let calls = 0, captured, authFailure = false, signedIn = true, missingKey = false, mode = 'success', timeout;
  const longError = 'The writing provider could not complete this request. '.repeat(15) + 'Full message ending: please retry later.';
  const route = loadTs('app/api/drama/generate/stage/route.ts', {
    require: name => name === '@/lib/session' ? { currentUser: async () => { if (authFailure) throw new Error('Fixture store unavailable'); return signedIn ? { id: 'test-owner' } : null; } } : name === '@/lib/apiKeyOverrides' ? { getProviderApiKey: async () => missingKey ? '' : 'fixture-key' } : require(name),
    console: { error: () => {} },
    AbortSignal: { timeout: ms => { timeout = ms; return new AbortController().signal; } },
    fetch: async (url, options) => {
      calls++; captured = JSON.parse(options.body);
      assert.match(url, /^https:\/\/api\.kie\.ai\//);
      if (mode === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
      if (mode === 'provider-error') return Response.json({ error: { message: longError } }, { status: 503 });
      if (mode === 'non-json') return new Response('Internal Server Error', { status: 500 });
      if (mode === 'malformed') return Response.json({ choices: [{ message: { content: 'This is not JSON.' } }] });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ brief: 'A complete generated brief from the mocked provider.' }) } }] });
    }
  });
  const request = body => new Request('http://local/api/drama/generate/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const input = { targetStage: 1, model: 'gemini-2.5-flash', snapshot: { roughStory: 'A story', episodes: 6, episodeLength: 2, continuity: 'Flexible' } };
  let response = await route.POST(request(input)); assert.equal(response.status, 200); assert.match((await response.json()).result.brief, /complete generated brief/); assert.equal(timeout, 210000); assert.match(captured.messages[1].content[0].text, /Flexible/);
  mode = 'provider-error'; response = await route.POST(request(input)); assert.equal(response.status, 502); assert.equal((await response.json()).message, longError);
  mode = 'non-json'; response = await route.POST(request(input)); assert.equal(response.status, 502); assert.match((await response.json()).message, /temporarily unavailable/);
  mode = 'malformed'; response = await route.POST(request(input)); assert.equal(response.status, 502); assert.equal((await response.json()).error, 'invalid_structured_output');
  mode = 'timeout'; const before = calls; response = await route.POST(request(input)); assert.equal(response.status, 504); assert.match((await response.json()).message, /3 minutes 30 seconds/); assert.equal(calls, before + 1, 'No automatic provider retry');
  authFailure = true; response = await route.POST(request(input)); assert.equal(response.status, 503); assert.equal((await response.json()).error, 'generation_unavailable'); authFailure = false;
  signedIn = false; response = await route.POST(request(input)); assert.equal(response.status, 401); signedIn = true;
  missingKey = true; response = await route.POST(request(input)); assert.equal(response.status, 401); missingKey = false;
  response = await route.POST(request(null)); assert.equal(response.status, 400);
  const { readDramaResponse } = loadTs('lib/drama/read-response.ts');
  await assert.rejects(readDramaResponse(new Response('Internal Server Error', { status: 500 })), /HTTP 500[\s\S]*Internal Server Error[\s\S]*inputs have been kept/);
  await assert.rejects(readDramaResponse(new Response('', { status: 502 })), /empty response/);
  assert.equal((await readDramaResponse(Response.json({ message: longError }, { status: 503 }))).message, longError);
  console.log('PASS actual stage handler: successful brief, complete provider error, non-JSON, malformed output, bounded timeout/no retry, auth/store/key/invalid-body failures; client error parsing');
})().catch(error => { console.error(error); process.exit(1); });
