const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Provider and content writes are intercepted before login. This suite never spends credits.
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], submissions = [], unexpectedWrites = [];
  const base = process.env.UAT_BASE_URL || 'http://localhost:3100';
  fs.mkdirSync('.playwright-mcp', { recursive: true });
  let releaseSubmission;
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/drama/brief-jobs') return route.fulfill({ json: { jobs: [] } });
    if (path === '/api/account/credits') return route.fulfill({ json: { user: { name: 'Demo', role: 'owner' }, workspace: { credits: 1000 }, providers: [] } });
    if (path.includes('credentials')) return route.fulfill({ json: { configured: true, statuses: { kie: { connected: true } } } });
    if (path === '/api/drama/generate/media' && request.method() === 'POST') {
      submissions.push(request.postDataJSON());
      await new Promise(resolve => { releaseSubmission = resolve; });
      return route.fulfill({ status: 503, json: { message: 'Simulated video provider failure; no real generation was submitted.' } });
    }
    if (request.method() !== 'GET' && path !== '/api/auth/login') {
      unexpectedWrites.push(path);
      return route.fulfill({ status: 400, json: { message: 'No-spend test blocked mutation.' } });
    }
    return route.continue();
  });
  await context.route('https://example.test/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await page.goto(base + '/drama-studio?step=5');
  const create = () => page.getByRole('button', { name: 'Create new generation job', exact: true }).click();
  await create();
  const source = () => page.getByRole('radio', { name: 'Available Story Studio', exact: true });
  const clearSource = () => page.getByRole('button', { name: 'Clear selection', exact: true });
  const generate = () => page.getByRole('button', { name: 'Generate selected scenes', exact: true });
  assert.equal(await page.getByRole('radio', { name: /^From scratch|^From Story Studio/ }).count(), 0, 'No starting-mode question');
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), '', 'New video starts with an empty prompt');
  assert(await page.getByRole('radio', { name: /^Kling 3.0/ }).isVisible(), 'Video models are visible without opening settings');
  assert(await generate().isDisabled(), 'An empty scene cannot be generated');
  await page.getByText('Your Story Studios will appear here once their scene prompts are ready.').waitFor();
  const prompt = 'A new standalone sunrise scene with a steady camera and warm light.';
  await page.getByLabel('Editable generation prompt').fill(prompt);
  await page.getByRole('radio', { name: /^Seedance 2.0/ }).check();
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.includes('drama-studio:draft-5')))).snapshot);
  await page.evaluate(snapshot => {
    const source = { ...snapshot, title: 'Available Story Studio', storyline: 'A courier explores a flooded city.', scenes: [1, 2].map(number => ({ id: 'source-' + number, episode: number, title: 'Source scene ' + number, prompt: 'Source prompt ' + number, duration: 5, safety: 'Clear', selected: true, status: 'draft' })), episodePlan: [1, 2].map(number => ({ number, title: 'Episode ' + number, summary: 'A city mystery.' })), episodes: 2, completed: [1, 2, 4] };
    const key = Object.keys(localStorage).find(key => key.includes('workflow-library-v2:'));
    localStorage.setItem(key, JSON.stringify({ records: [{ id: 'video-uat-story', stage: 2, name: source.title, status: 'ready', createdAt: new Date().toISOString(), snapshot: source }, { id: 'video-uat-result', stage: 5, name: 'Video actions review', createdAt: new Date().toISOString(), snapshot: { ...source, scenes: source.scenes.map(scene => ({ ...scene, status: 'ready', resultUrl: 'https://example.test/video.mp4' })) } }], selectedIds: { 2: 'video-uat-story', 5: 'video-uat-result' } }));
  }, snapshot);
  await page.reload(); await create();
  assert(!(await source().isChecked()), 'Standalone draft does not relink to an available source');
  assert.equal(await clearSource().count(), 0, 'No clear button when no source is selected');
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), prompt);
  assert(await page.getByRole('radio', { name: /^Seedance 2.0/ }).isChecked(), 'Video model survives refresh');
  await source().check();
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), 'Source prompt 1');
  const episodes = page.getByRole('tablist', { name: 'Episodes to prepare', exact: true });
  assert.equal(await episodes.getByRole('tab').count(), 2);
  await page.getByLabel('Editable generation prompt').fill('Edited Story Studio prompt before generation.');
  await episodes.getByRole('tab').last().click(); await episodes.getByRole('tab').first().click();
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), 'Edited Story Studio prompt before generation.');
  await page.reload(); await create();
  assert(await source().isChecked(), 'Source selection survives refresh');
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), 'Edited Story Studio prompt before generation.');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Video creation document overflow at ' + width);
    const overflow = await page.locator('.create-stage-card').evaluate(root => [...root.querySelectorAll('*')].filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2 && !['TEXTAREA', 'INPUT'].includes(element.tagName)).map(element => element.className));
    assert.deepEqual(overflow, [], 'Video creation nested overflow at ' + width);
    const settings = page.getByRole('region', { name: 'Video generation settings', exact: true });
    assert(await settings.getByRole('heading', { name: 'Generation settings', exact: true }).isVisible());
    const modelCard = await settings.locator('.generated-job-setting-fields > .studio-model-choices .brief-choice-options > label').first().boundingBox();
    const ratioCard = await settings.locator('.video-secondary-settings .brief-choice-options > label').first().boundingBox();
    assert(modelCard.height >= ratioCard.height + 20, 'Model cards have more space than secondary settings at ' + width);
    assert(await settings.locator('.video-secondary-settings .brief-choice-options').first().evaluate(root => { const boxes=[...root.children].map(element=>element.getBoundingClientRect()); return boxes.every(box => Math.abs(box.top-boxes[0].top)<2); }), 'Compact ratio options remain on one row at ' + width);
    await settings.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.playwright-mcp/video-settings-' + width + '.png' });
  }
  assert.equal(submissions.length, 0, 'Source/model/tab changes never start generation');
  await clearSource().click();
  assert(!(await source().isChecked()), 'Clear removes the selected source');
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), '', 'Clear selection resets inherited scene content');
  assert.equal(await page.locator('.create-scene-row').count(), 1);
  await page.getByLabel('Editable generation prompt').fill(prompt);
  await page.getByRole('radio', { name: /^Kling V3 Turbo/ }).check();
  await generate().click();
  await page.getByRole('button', { name: 'Generating with Kie AI', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Generating with Kie AI', exact: true }).isDisabled());
  assert.equal(submissions.length, 1); assert.equal(submissions[0].model, 'kling-v3-turbo');
  assert(submissions[0].prompt.includes(prompt));
  releaseSubmission(); await generate().waitFor();
  assert.equal(await page.getByLabel('Editable generation prompt').inputValue(), prompt, 'Failure retains entered prompt');
  // Source generation submits the selected model and edited scene, without modifying the saved original.
  await source().check();
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await page.getByRole('button', { name: 'Select Source scene 1', exact: true }).click();
  await page.getByLabel('Editable generation prompt').fill('Final edited source clip.');
  await page.getByRole('radio', { name: /^Seedance 2.0/ }).check();
  await generate().click(); await page.getByRole('button', { name: 'Generating with Kie AI', exact: true }).waitFor();
  assert.equal(submissions.length, 2); assert.equal(submissions[1].model, 'seedance-2.0'); assert(submissions[1].prompt.includes('Final edited source clip.'), submissions[1].prompt);
  releaseSubmission(); await generate().waitFor();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.includes('workflow-library-v2:')))).records.find(record => record.id === 'video-uat-story'));
  assert.equal(original.snapshot.scenes[0].prompt, 'Source prompt 1');
  await page.goto(base + '/drama-studio?step=5');
  const card = page.locator('.video-job-card');
  await card.waitFor();
  const expand = card.getByRole('button', { name: 'Expand Video actions review', exact: true });
  if (await expand.count()) await expand.click();
  const expandEpisode = card.getByRole('button', { name: 'Expand Episode 1', exact: true });
  if (await expandEpisode.count()) await expandEpisode.click();
  assert(await card.locator('.generated-job-settings').evaluate(element => element.open), 'Library generation settings are expanded initially');
  assert(await card.getByRole('radio', { name: /^Seedance 2.0/ }).isChecked(), 'Library settings retain the chosen model');
  await card.locator('.episode-generation-actions').waitFor();
  assert.equal(await page.getByText('Generate every clip, or generate and automatically combine the full episode.', { exact: true }).count(), 0);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200);
    const actions = card.locator('.episode-generation-actions');
    const settings = card.locator('.generated-job-settings');
    const modelCard = await settings.locator('.generated-job-setting-fields > .studio-model-choices .brief-choice-options > label').first().boundingBox();
    const secondaryCard = await settings.locator('.video-secondary-settings .brief-choice-options > label').first().boundingBox();
    assert(modelCard.height >= secondaryCard.height + 20, 'Library model choices dominate smaller sound controls at ' + width);
    assert(await actions.evaluate(root => root.scrollWidth <= root.clientWidth), 'Generation action row overflow at ' + width);
    for (const button of await actions.getByRole('button').all()) assert(await button.evaluate(element => element.scrollWidth <= element.clientWidth), 'Action text clips at ' + width);
    assert(await actions.locator('.generated-episode-combine').evaluate(button => getComputedStyle(button).whiteSpace === 'nowrap'), 'Combine label stays on one line');
    assert(await actions.evaluate(root => { const boxes = [...root.querySelectorAll('button')].map(button => button.getBoundingClientRect()); return boxes.every((box, index) => boxes.slice(index + 1).every(other => Math.min(box.right, other.right) - Math.max(box.left, other.left) <= 1 || Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) <= 1)); }), 'Generation buttons overlap at ' + width);
  await actions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.playwright-mcp/video-actions-' + width + '.png' });
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedWrites, []);
  console.log('PASS: optional Story selection/clear, empty manual video creation, prominent settings with compact secondary options, draft/source persistence, exact model payloads, pending locks, failure retention, source isolation, responsive action alignment; no paid calls.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
