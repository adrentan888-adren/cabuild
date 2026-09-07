const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// Safe UAT: every generation, storage write and media request is intercepted.
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = [], posts = [], releases = new Map();
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.UAT_BASE_URL || 'http://localhost:3100';
  const snapshot = { completed: [1], title: 'Coral City', roughStory: 'An underwater courier finds a lost district.', generatedBrief: 'ORIGINAL SAVED BRIEF: A courier finds a hidden city.', episodes: 6, episodeLength: 3, style: 'Cinematic mystery', language: 'Japanese', aspectRatio: '9:16', pacing: 'Slow burn', audience: 'Young adults', rating: 'PG-13', tone: ['Mystery'], continuity: 'Flexible', storyline: '', episodePlan: [], characters: [], assets: [], scenes: [], autoFallback: true, assembled: false, episodeDrafts: 0 };
  const sourceId = crypto.randomUUID();
  const jobs = new Map([[sourceId, { id: sourceId, stage: 1, snapshot, model: 'gemini-2.5-flash', status: 'ready', createdAt: new Date().toISOString() }]]);
  const otherId = crypto.randomUUID(); jobs.set(otherId, { ...jobs.get(sourceId), id: otherId, snapshot: { ...snapshot, title: 'Desert Signals', generatedBrief: 'A radio operator discovers a lost station.' } });
  const failedSourceId = crypto.randomUUID(); jobs.set(failedSourceId, { ...jobs.get(sourceId), id: failedSourceId, status: 'failed', error: 'Old failed source', snapshot: { ...snapshot, title: 'Failed Source', generatedBrief: '' } });
  const pendingSourceId = crypto.randomUUID(); jobs.set(pendingSourceId, { ...jobs.get(sourceId), id: pendingSourceId, status: 'generating', snapshot: { ...snapshot, title: 'Pending Source', generatedBrief: '' } });
  let nextFailure = false, getCount = 0;
  const fullError = 'Story Studio provider connection failed with complete diagnostic detail. '.repeat(18) + 'FULL STORY FAILURE END';
  await context.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname, method = route.request().method();
    if (p === '/api/drama/brief-jobs') {
      if (method === 'GET') { getCount++; return route.fulfill({ json: { ok: true, jobs: [...jobs.values()] } }); }
      if (method === 'DELETE') { jobs.delete(new URL(route.request().url()).searchParams.get('id')); return route.fulfill({ json: { ok: true } }); }
      const body = route.request().postDataJSON(); posts.push(body);
      assert.equal(body.stage, 2, 'Story generation must use the durable stage-two endpoint');
      const job = { ...body, status: 'generating', createdAt: new Date().toISOString() }; jobs.set(job.id, job);
      const failure = nextFailure;
      await new Promise(resolve => releases.set(job.id, resolve));
      if (failure) { job.status = 'failed'; job.error = fullError; }
      else { job.status = 'ready'; job.snapshot = { ...job.snapshot, completed: [1,2], storyline: 'GENERATED STORY: The courier opens the city gates.', episodePlan: [{ number: 1, title: 'The first parcel', summary: 'The parcel holds a key.' }], characters: [{ name: 'Mara', role: 'Courier', appearance: 'Blue coat', personality: 'Curious', arc: 'Trusts her crew' }], assets: [{ id: 'mara-1', name: 'Mara', type: 'Character', detail: 'Courier', visualPrompt: 'Mara in a blue coat', selected: true, status: 'planned', crop: '18% center' }], scenes: [], episodeDrafts: 1 }; }
      return route.fulfill({ json: { ok: true, job } }).catch(() => {});
    }
    if (p === '/api/account/credits') return route.fulfill({ json: { user: { name: 'Demo', email: 'demo@example.test', role: 'owner' }, workspace: { credits: 1000 }, providers: [] } });
    if (p.includes('credentials')) return route.fulfill({ json: { configured: true, statuses: { kie: { connected: true } } } });
    if (p.includes('credits')) return route.fulfill({ json: { credits: 1000 } });
    if (method !== 'GET' && p !== '/api/auth/login') return route.fulfill({ status: 400, json: { message: 'UAT blocked mutation' } });
    return route.continue();
  });
  await page.goto(base + '/login'); await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.locator('.global-header').waitFor(); await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await page.goto(base + '/drama-studio?step=1');
  const sourceCard = page.locator('.brief-library-card').filter({ has: page.getByRole('heading', { name: 'Coral City', exact: true }) });
  await sourceCard.getByRole('button', { name: 'Add Coral City to favorites' }).click();
  await page.locator('.workspace-navigation').getByRole('link', { name: 'Story Studio', exact: true }).click();
  await page.waitForURL('**/drama-studio?step=2');
  const create = page.getByRole('button', { name: /Create new/i }).first(); await create.click();
  const form = page.locator('.story-creation-form'); await form.waitFor();
  assert.equal(await form.locator('select').count(), 0, 'No dropdowns in story creation');
  assert.equal(await form.getByLabel('Aspect ratio', { exact: true }).count(), 0, 'Aspect ratio is inherited without another input');
  assert(await form.locator('#story-production-title').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 24));
  assert.equal(await form.getByRole('radio').count(), 2);
  await form.getByRole('button', { name: /Choose Brief|Change Brief/ }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your starting point' }); await picker.waitFor();
  assert.equal(await picker.locator('.saved-work-card').count(), 2, 'Failed and generating sources omitted');
  await picker.getByRole('button', { name: 'Favorites', exact: true }).click();
  assert.equal(await picker.locator('.saved-work-card').count(), 1);
  await picker.getByRole('button', { name: 'Favorites', exact: true }).click();
  await picker.getByRole('textbox', { name: 'Search saved briefs' }).fill('Coral');
  assert.equal(await picker.locator('.saved-work-card').count(), 1);
  await picker.getByRole('radio').check();
  assert.equal((await picker.locator('.saved-work-card').innerText()).trim(), 'Coral City', 'Available brief choices show titles only');
  assert.equal(await picker.locator('.saved-work-preview').count(), 0, 'Picker has no Info/preview section');
  await picker.getByRole('button', { name: 'Use this brief' }).click(); await picker.waitFor({ state: 'hidden' });
  assert.equal(await form.locator('#story-finished-brief').inputValue(), snapshot.generatedBrief);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Story form overflow at ' + width);
    await form.getByRole('button', { name: 'Change Brief' }).click(); await picker.waitFor();
    assert(await picker.evaluate(el => el.scrollWidth <= el.clientWidth), 'Picker overflow at ' + width);
    await page.screenshot({ path: '.playwright-mcp/story-picker-' + width + '.png', fullPage: true });
    await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const edited = 'EDITED SUBMITTED BRIEF: The courier must rescue a missing sibling.';
  await form.locator('#story-finished-brief').fill(edited); await form.locator('#story-production-title').fill('Coral Story');
  await form.getByRole('radio', { name: /Gemini 2.5 Flash/ }).check();
  assert.match(await form.locator('.brief-generate-footer').innerText(), /Estimated cost/);
  await form.getByRole('button', { name: 'Generate', exact: true }).click();
  const card = page.locator('.story-library-card').filter({ has: page.getByRole('heading', { name: 'Coral Story', exact: true }) });
  await card.getByText('Generating', { exact: true }).waitFor(); assert.equal(await form.count(), 0); assert.equal(posts.length, 1);
  assert.equal(posts[0].snapshot.generatedBrief, edited); assert.equal(posts[0].snapshot.aspectRatio, '9:16'); assert.equal(posts[0].sourceId, sourceId);
  assert.equal(jobs.get(sourceId).snapshot.generatedBrief, snapshot.generatedBrief, 'Saved source is unchanged');
  assert(await card.getByRole('button', { name: 'Delete Coral Story' }).isDisabled());
  await page.reload(); await card.getByText('Generating', { exact: true }).waitFor(); assert.equal(posts.length, 1, 'Reload never resubmits');
  releases.get(posts[0].id)(); await card.getByText('Ready', { exact: true }).waitFor({ timeout: 12000 });
  await card.getByRole('button', { name: 'Expand Coral Story' }).click();
  const storyEditor = card.locator('.story-studio-storyline'); await storyEditor.fill('USER EDIT: Preserve this revised storyline after polling.');
  const beforePoll = getCount; await page.waitForTimeout(6500); assert(getCount > beforePoll);
  assert.equal(await storyEditor.inputValue(), 'USER EDIT: Preserve this revised storyline after polling.');
  await page.reload(); await card.getByRole('button', { name: 'Expand Coral Story' }).click();
  assert.equal(await storyEditor.inputValue(), 'USER EDIT: Preserve this revised storyline after polling.');
  await card.getByRole('button', { name: 'Collapse Coral Story' }).click();
  await card.getByRole('button', { name: 'Add Coral Story to favorites' }).click();
  assert.equal(await card.getByRole('button', { name: 'Remove Coral Story from favorites' }).getAttribute('aria-pressed'), 'true');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Story card overflow at ' + width);
    await card.getByRole('button', { name: 'Info for Coral Story' }).click();
    const info = page.getByRole('dialog'); await info.waitFor(); assert.equal(await info.locator('input,textarea,select').count(), 0);
    assert.match(await info.innerText(), /USER EDIT[\s\S]*Submitted brief[\s\S]*EDITED SUBMITTED BRIEF[\s\S]*Aspect ratio[\s\S]*9:16/);
    assert(await info.evaluate(el => el.scrollWidth <= el.clientWidth), 'Story Info overflow at ' + width);
    await page.screenshot({ path: '.playwright-mcp/story-info-' + width + '.png', fullPage: true });
    await page.mouse.click(2, 2); await info.waitFor({ state: 'hidden' });
    assert(await card.getByRole('button', { name: 'Info for Coral Story' }).evaluate(el => el === document.activeElement));
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await create.click(); await form.waitFor();
  assert.equal(await form.locator('.story-source-summary button').count(), 1, 'Selected source has one Change Brief button');
  assert.equal(await form.getByRole('button', { name: 'Use as own input' }).count(), 0);
  await form.locator('#story-production-title').fill('Failed Coral Story'); await form.locator('#story-finished-brief').fill('A new editable standalone brief.'); nextFailure = true;
  await form.getByRole('button', { name: 'Generate', exact: true }).click();
  const failed = page.locator('.story-library-card').filter({ has: page.getByRole('heading', { name: 'Failed Coral Story', exact: true }) });
  await failed.getByText('Generating', { exact: true }).waitFor(); assert(posts[1].sourceId, 'Edited selected brief retains source provenance'); releases.get(posts[1].id)(); await failed.getByText('Failed', { exact: true }).waitFor();
  await failed.getByRole('button', { name: 'Info for Failed Coral Story' }).click(); assert.match(await page.getByRole('dialog').innerText(), /FULL STORY FAILURE END/); await page.keyboard.press('Escape');
  await page.reload(); await failed.getByText('Failed', { exact: true }).waitFor(); assert.equal(posts.length, 2);
  assert.deepEqual(errors, []); console.log('PASS Story Studio: title-only saved brief picker, search/favorites, single Change Brief action, edited copy and inherited format, model cards, immediate Generating, refresh without resubmit, Ready/Failed and complete errors, source provenance, local edits survive polling/reload, themed collapse/favorite/Info, outside dismissal, desktop/mobile. All generation and storage writes mocked.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
