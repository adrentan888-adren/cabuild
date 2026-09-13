const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
// No-spend browser regression: provider calls, durable jobs and writes are mocked.
(async () => {
  fs.mkdirSync('.playwright-mcp', { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], mediaPosts = [], promptPosts = [], heldMedia = [], heldPrompts = [];
  const taskStates = new Map(), statusCalls = new Map(), receiptHeaders = new Map();
  let nextAcceptedFailure = null;
  const until = async (condition, message) => { const deadline=Date.now()+12000; while(!condition()){ assert(Date.now()<deadline,message); await page.waitForTimeout(50); } };
  page.on('pageerror', e => errors.push(e.message));
  const id = crypto.randomUUID(), base = process.env.UAT_BASE_URL || 'http://localhost:3100';
  const snapshot = { completed: [1,2,4], title: 'Tidal Letters', generatedBrief: 'A courier discovers a city under the sea.', roughStory: 'A courier discovers a city under the sea.', episodes: 2, episodeLength: 3, style: 'Cinematic', language: 'English', aspectRatio: '9:16', pacing: 'Balanced', audience: 'Adults', rating: 'PG-13', tone: ['Mystery'], continuity: 'Strict', storyline: 'Mara follows the letters through the hidden city.', episodePlan: [{ number: 1, title: 'The first letter', summary: 'Mara discovers a mysterious envelope.' }, { number: 2, title: 'The gate', summary: 'Mara finds the city gate.' }], characters: [{ name: 'Mara', role: 'Courier' }, { name: 'Finn', role: 'Guide' }], assets: [{ id: 'mara', name: 'Mara', type: 'Character', detail: 'Courier in a blue coat', visualPrompt: 'Mara in blue at the harbour', selected: true, status: 'planned' }, { id: 'finn', name: 'Finn', type: 'Character', detail: 'A guide', visualPrompt: 'Finn at the gate', selected: true, status: 'planned' }, { id: 'gate', name: 'City gate', type: 'Venue', detail: 'The underwater entrance', visualPrompt: 'A stone gate underwater', selected: true, status: 'planned' }], scenes: [{ id: 'E1-S1', episode: 1, title: 'The envelope arrives', duration: 5, prompt: 'Mara opens an envelope in the rain.', safety: 'Safe', selected: true, status: 'draft' }, { id: 'E2-S1', episode: 2, title: 'Opening the gate', duration: 5, prompt: 'Mara opens the city gate.', safety: 'Safe', selected: true, status: 'draft' }], autoFallback: true, assembled: false, episodeDrafts: 2 };
  const job = { id, stage: 2, snapshot, status: 'ready', model: 'gemini-2.5-flash', createdAt: new Date().toISOString() };
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.pathname === '/api/drama/brief-jobs') return route.fulfill({ json: { ok: true, jobs: [job] } });
    if (url.pathname === '/api/drama/generate/stage') {
      const body = req.postDataJSON(); promptPosts.push(body);
      await new Promise(resolve => heldPrompts.push(resolve));
      return route.fulfill({ json: { ok: true, model: body.model, result: { scenes: body.snapshot.episodePlan.map(episode => ({ id: `E${episode.number}-S1`, episode: episode.number, title: episode.title + ' generated prompt', duration: 5, prompt: 'A generated scene at the harbour.', safety: 'Safe' })) } } });
    }
    if (url.pathname === '/api/drama/generate/media') {
      if (method === 'POST') {
        const body = req.postDataJSON(); mediaPosts.push(body);
        const taskId = 'task-' + mediaPosts.length; const acceptedFailure=nextAcceptedFailure; nextAcceptedFailure=null; taskStates.set(taskId, { state: 'generating', progress: 20, diagnostic: { operation: 'status', httpStatus: 200 } });
        await new Promise(resolve => heldMedia.push(resolve));
        if(acceptedFailure) return route.fulfill({status:503,json:{error:'storage_unavailable',taskId,model:body.model,accepted:true,storagePending:true,message:'Accepted media task tracking is recovering. Do not submit again.',...acceptedFailure}});
        return route.fulfill({ json: { ok: true, taskId, model: body.model } });
      }
      const taskId = url.searchParams.get('taskId'); receiptHeaders.set(taskId,req.headers()['x-drama-task-receipt']); statusCalls.set(taskId, (statusCalls.get(taskId) || 0) + 1);
      const state = taskStates.get(taskId) || { state: 'generating', progress: 10 };
      if (state.abort) return route.abort('failed');
      return route.fulfill({ status: state.httpStatus || 200, json: state });
    }
    if (url.pathname === '/api/account/credits') return route.fulfill({ json: { user: { name: 'Demo', email: 'demo@example.test', role: 'owner' }, workspace: { credits: 1000 }, providers: [] } });
    if (url.pathname.includes('credentials')) return route.fulfill({ json: { configured: true, statuses: { kie: { connected: true } } } });
    if (url.pathname.includes('credits')) return route.fulfill({ json: { credits: 1000 } });
    if (method !== 'GET' && url.pathname !== '/api/auth/login') return route.fulfill({ status: 400, json: { message: 'No-spend UAT blocked mutation' } });
    return route.continue();
  });
  await page.goto(base + '/login'); await page.getByRole('button', { name: 'Enter workspace' }).click(); await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await page.goto(base + '/drama-studio?step=2');
  const card = page.locator('.story-library-card');
  const expand = async () => { const button = card.getByRole('button', { name: 'Expand Tidal Letters' }); if (await button.count()) await button.click(); };
  await card.waitFor(); await expand();
  const workspace = card.locator('.story-studio-workspace');
  const section = async name => workspace.getByRole('tablist', { name: 'Story workspace', exact: true }).getByRole('tab', { name: new RegExp('^' + name + '(?: |$)') }).click();
  const settings = async name => { const detail = workspace.locator('details').filter({ has: page.locator('summary').filter({hasText: name}) }).first(); if ((await detail.getAttribute('open')) === null) await detail.locator('summary').first().click(); };
  const selectAsset = async name => { await section('Images'); await workspace.getByRole('tablist', { name: 'Image groups', exact: true }).getByRole('tab', { name: /^Characters/ }).click(); await workspace.getByRole('heading', { name, exact: true }).waitFor(); };
  await settings('Generation settings');
  assert.equal(await workspace.locator('select').count(), 0, 'No dropdowns inside Story Studio');
  assert.equal(await workspace.getByRole('group', { name: 'Prompt model', exact: true }).getByRole('radio').count(), 2);

  assert.equal(await workspace.getByRole('slider', { name: 'Episodes to generate' }).count(), 0);
  assert(await workspace.getByLabel('Episode 1 title', { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 20));
  await section('Series'); assert(await workspace.getByLabel('Series storyline', { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16)); await section('Episodes'); await settings('Generation settings');
  const firstPrompt = workspace.locator('.story-studio-scenes article').first();
  assert.equal(await workspace.locator('.story-studio-scenes details').count(), 0, 'Every prompt stays open');
  assert(await firstPrompt.getByRole('heading').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 18));
  assert(await firstPrompt.getByRole('textbox').isVisible());
  await firstPrompt.getByRole('textbox').fill('Edited prompt: the envelope glows in the rain.');
  const asset = name => workspace.locator('.story-studio-asset').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await selectAsset('Mara'); await settings('Image settings'); assert(await workspace.getByRole('group', { name: 'Image generation model', exact: true }).getByRole('radio').count() >= 2); assert(await asset('Mara').getByRole('textbox').isVisible()); await section('Episodes'); await settings('Generation settings');
  const bulkPrompts = workspace.getByRole('button', { name: 'Regenerate all episode prompts', exact: true });
  await bulkPrompts.click(); await page.waitForFunction(() => document.querySelector('.compact-episode-workspace .story-studio-subsection-head button')?.disabled);
  assert(await workspace.getByRole('button', { name: 'Generating 2 episodes', exact: true }).isDisabled());
  for (const button of await workspace.getByRole('button', { name: 'Regenerate episode prompts', exact: true }).all()) assert(await button.isDisabled());
  assert.equal(promptPosts.length, 1); heldPrompts.shift()(); await bulkPrompts.waitFor(); assert(await bulkPrompts.isEnabled());
  await workspace.getByRole('button', { name: 'Regenerate episode prompts', exact: true }).first().click();
  assert(await bulkPrompts.isDisabled()); assert(await workspace.getByRole('button', { name: 'Regenerating', exact: true }).isDisabled());
  assert.equal(await workspace.getByRole('button', { name: 'Regenerate episode prompts', exact: true }).count(), 0);
  assert.equal(promptPosts.length, 2); heldPrompts.shift()(); await page.waitForFunction(() => !document.querySelector('.compact-episode-workspace .story-studio-subsection-head button')?.disabled);
  await selectAsset('Mara');
  const characters = () => workspace.getByRole('button', { name: /^(Generate|Generating) all characters$/ });
  await asset('Mara').getByRole('button', { name: 'Generate image', exact: true }).click();
  assert(await asset('Mara').getByRole('button', { name: 'Generating with Kie AI', exact: true }).isDisabled()); assert(await characters().isDisabled());
  assert.equal(mediaPosts.length, 1); heldMedia.shift()();
  await page.waitForTimeout(1700); assert((statusCalls.get('task-1') || 0) >= 1);
  assert.equal(await page.locator('.temporary-error-log').count(), 0, 'Normal generating diagnostics do not become errors');
  assert.doesNotMatch(await workspace.innerText(), /checking every\s*4\s*(?:s|seconds)\b/i);
  await page.reload(); await card.waitFor(); await expand(); await selectAsset('Mara');
  assert(await asset('Mara').getByRole('button', { name: 'Generating with Kie AI', exact: true }).isDisabled()); assert(await characters().isDisabled()); assert.equal(mediaPosts.length, 1, 'Refresh never resubmits media');
  taskStates.set('task-1', { state: 'success', resultUrls: ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'], diagnostic: { httpStatus: 200 } });
  await asset('Mara').getByRole('button', { name: 'Regenerate image', exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.temporary-error-log').count(), 0, 'Normal successful diagnostics do not become errors');
  await characters().click(); assert(await characters().isDisabled());
  assert(await asset('Mara').getByRole('button', { name: 'Generating with Kie AI', exact: true }).isDisabled()); await selectAsset('Finn'); assert(await asset('Finn').getByRole('button', { name: 'Generating with Kie AI', exact: true }).isDisabled());
  await page.waitForTimeout(100); assert.equal(mediaPosts.length, 2); heldMedia.shift()();
  await page.waitForTimeout(100); assert.equal(mediaPosts.length, 3); assert(await characters().isDisabled()); heldMedia.shift()();
  taskStates.set('task-2', { httpStatus: 503, message: 'Temporary provider status failure' });
  taskStates.set('task-3', { state: 'success', resultUrls: ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'] });
  await asset('Finn').getByRole('button', { name: 'Regenerate image', exact: true }).waitFor({ timeout: 10000 });
  const log = page.getByRole('textbox', { name: 'Kie failed-task output', exact: true }); await log.waitFor();
  const beforeRepeat = statusCalls.get('task-2') || 0; await page.waitForTimeout(4500); assert((statusCalls.get('task-2') || 0) > beforeRepeat);
  assert.equal(JSON.parse(await log.inputValue()).entries.filter(entry => entry.taskId === 'task-2').length, 1, 'Identical transient failures deduplicated');
  taskStates.set('task-2', { httpStatus: 404, message: 'Media task not found for this owner.' });
  await selectAsset('Mara');
  await asset('Mara').getByText('Media task not found for this owner.', { exact: true }).waitFor({ timeout: 10000 });
  const afterPermanent = statusCalls.get('task-2'); await page.waitForTimeout(4500); assert.equal(statusCalls.get('task-2'), afterPermanent, 'Permanent 404 stops automatic status calls');
  assert(await asset('Mara').getByRole('button', { name: 'Generate image', exact: true }).isEnabled());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.includes('workflow-library-v2')))));
  assert.equal(saved.records.find(record => record.id === id).snapshot.assets.find(item => item.id === 'mara').taskId, 'task-2', 'Permanent failure preserves task ID');
  // A provider-accepted job must never be resubmitted when tracking persistence fails.
  nextAcceptedFailure = { recoveryReceipt: 'mock-proof' };
  await asset('Mara').getByRole('button', { name: 'Generate image', exact: true }).click();
  await until(() => mediaPosts.length === 4, 'Accepted job request received');
  taskStates.set('task-4', { httpStatus:503, error:'storage_unavailable', message:'Temporary tracking recovery outage' }); heldMedia.shift()();
  await asset('Mara').getByText('Accepted media task tracking is recovering. Do not submit again.', { exact:true }).waitFor();
  assert(await asset('Mara').getByRole('button', {name:'Generating with Kie AI',exact:true}).isDisabled());
  const persistedAsset = async name => page.evaluate(({id,name}) => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.includes('workflow-library-v2')))).records.find(record=>record.id===id).snapshot.assets.find(item=>item.name===name), {id,name});
  let recovering = await persistedAsset('Mara'); assert.equal(recovering.taskId,'task-4'); assert.equal(recovering.recoveryReceipt,'mock-proof'); assert.equal(recovering.taskRecoveryPending,true);
  await page.reload(); await card.waitFor(); await expand(); await selectAsset('Mara');
  assert(await asset('Mara').getByRole('button',{name:'Generating with Kie AI',exact:true}).isDisabled()); assert(await characters().isDisabled());
  await until(()=>(statusCalls.get('task-4')||0)>=1,'Recovery status checked');
  assert.equal(receiptHeaders.get('task-4'),'mock-proof','Owner recovery receipt travels in status request header');
  assert.equal(mediaPosts.length,4,'503 receipt recovery refresh never resubmits');
  recovering=await persistedAsset('Mara'); assert.equal(recovering.status,'generating'); assert.equal(recovering.recoveryReceipt,'mock-proof');
  const beforeWaiting=statusCalls.get('task-4'); taskStates.set('task-4',{state:'waiting',progress:25});
  await until(()=>(statusCalls.get('task-4')||0)>beforeWaiting,'Waiting state recovered');
  await page.waitForTimeout(150); recovering=await persistedAsset('Mara'); assert.equal(recovering.status,'generating'); assert.equal(recovering.taskRecoveryPending,undefined);
  taskStates.set('task-4',{state:'success',resultUrls:['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7']});
  await asset('Mara').getByRole('button',{name:'Regenerate image',exact:true}).waitFor({timeout:10000}); assert.equal(mediaPosts.length,4);
  // Without a receipt, an accepted but untracked task stays locked until an explicit status check can recover it.
  nextAcceptedFailure = {};
  await selectAsset('Finn');
  await asset('Finn').getByRole('button',{name:'Regenerate image',exact:true}).click();
  await until(()=>mediaPosts.length===5,'Unreceipted accepted task request received');
  taskStates.set('task-5',{httpStatus:404,message:'Accepted task ownership tracking is unavailable.'}); heldMedia.shift()();
  const checkStatus=asset('Finn').getByRole('button',{name:'Check status',exact:true}); await checkStatus.waitFor({timeout:10000});
  assert(await asset('Finn').getByRole('button',{name:'Generating with Kie AI',exact:true}).isDisabled());
  assert.equal(await asset('Finn').getByRole('button',{name:/^(Generate|Regenerate) image$/}).count(),0);
  const blockedCalls=statusCalls.get('task-5'); await page.waitForTimeout(4500); assert.equal(statusCalls.get('task-5'),blockedCalls,'Untracked accepted task stops automatic requests');
  recovering=await persistedAsset('Finn'); assert.equal(recovering.taskId,'task-5'); assert.equal(recovering.status,'generating'); assert.equal(recovering.taskRecoveryPending,true); assert.equal(recovering.taskRecoveryBlocked,true); assert.equal(recovering.recoveryReceipt,undefined);
  await page.reload(); await card.waitFor(); await expand(); await selectAsset('Finn'); await checkStatus.waitFor();
  assert(await asset('Finn').getByRole('button',{name:'Generating with Kie AI',exact:true}).isDisabled()); assert(await characters().isDisabled()); assert.equal(mediaPosts.length,5);
  taskStates.set('task-5',{httpStatus:503,message:'Manual status recovery is temporarily unavailable.'});
  await checkStatus.click();
  await page.locator('.status-notice-message').getByText('Some media statuses could not be refreshed. Manual status recovery is temporarily unavailable.',{exact:true}).waitFor();
  assert.equal(await page.locator('.status-notice-message b').innerText(),'Failed','Manual status error must not emit a Success notice');
  recovering=await persistedAsset('Finn'); assert.equal(recovering.status,'generating'); assert.equal(recovering.taskRecoveryBlocked,true); assert.equal(mediaPosts.length,5);
  if(await page.getByRole('button', { name: 'Clear', exact: true }).count()) await page.getByRole('button', { name: 'Clear', exact: true }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Story controls overflow at ' + width);
    for (const [name, prepare, target] of [
      ['episodes', async () => section('Episodes'), workspace.locator('.story-studio-episodes')],
      ['prompt-models', async () => { await section('Episodes'); await settings('Generation settings'); }, workspace.locator('.story-studio-prompt-controls')],
      ['image-models', async () => { await section('Images'); await settings('Image settings'); }, workspace.getByRole('group', { name: 'Image generation model', exact: true })],
      ['asset', async () => selectAsset('Mara'), asset('Mara')]
    ]) {
      await prepare(); await target.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
      assert(await target.evaluate(el => el.scrollWidth <= el.clientWidth), name + ' nested overflow at ' + width);
      await page.screenshot({ path: '.playwright-mcp/story-controls-' + name + '-' + width + '.png' });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS Story controls: model radios without count slider, larger editable titles/storyline, always-visible keyboard-accessible prompts, prompt batch/individual exclusion, image submission/group/persisted pending locks, no resubmit on refresh, only real errors logged, partial polling success, deduplicated transient errors, permanent404 stop with task ID preserved, accepted503 receipt recovery and unreceipted generation locks, manual status errors remain failures, responsive 1440/768/390/320. All generation/storage writes intercepted.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
