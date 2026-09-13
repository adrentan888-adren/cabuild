const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let generationCalls = 0;
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/account/credits') return route.fulfill({ json: { user: { name: 'Demo', role: 'owner' }, workspace: { credits: 1000 }, providers: [] } });
    if (path.includes('credentials')) return route.fulfill({ json: { configured: true, statuses: { kie: { connected: true } } } });
    if (path.includes('credits')) return route.fulfill({ json: { credits: 1000 } });
    if (path === '/api/drama/brief-jobs' && request.method() === 'GET') return route.fulfill({ json: { ok: true, jobs: [] } });
    if (request.method() !== 'GET' && path !== '/api/auth/login') {
      generationCalls++;
      return route.fulfill({ status: 403, json: { message: 'No-spend navigation UAT' } });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.UAT_BASE_URL || 'http://localhost:3100';
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await page.goto(base + '/drama-studio?step=1');
  const navigation = () => page.locator('.workspace-navigation:visible');
  const assetButton = () => page.locator('.workspace-library-tools:visible').getByRole('link', { name: 'Asset Library', exact: true });
  const waitForVideoLibrary = async () => {
    // The loading shell capitalizes Edit; only the settled library proves the route rendered.
    await page.locator('.stage-library-panel:visible').waitFor();
    await page.getByRole('heading', { name: 'Generate & edit', exact: true }).waitFor();
    assert.equal(await navigation().getByRole('link', { name: 'Generate & Edit', exact: true }).getAttribute('aria-current'), 'page');
  };
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await navigation().getByRole('link').count(), 4);
    assert.equal(await navigation().getByRole('link', { name: 'Asset Library', exact: true }).count(), 0);
    assert.equal(await assetButton().getAttribute('href'), '/drama-studio/assets');
    const box = await assetButton().boundingBox();
    assert(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `Asset Library button fits ${width}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Reach Generate & Edit through the local stage navigation before crossing routes.
  await navigation().getByRole('link', { name: 'Generate & Edit', exact: true }).click();
  await page.waitForURL('**/drama-studio?step=5');
  await navigation().getByRole('link', { name: 'Production Info', exact: true }).click();
  await page.waitForURL('**/drama-studio/info');
  await page.getByRole('heading', { name: 'Production Info', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'No combined episodes yet' }).waitFor();
  assert.equal(await navigation().getByRole('link', { name: 'Production Info', exact: true }).getAttribute('aria-current'), 'page');
  await page.getByRole('link', { name: 'Open Generate & Edit' }).click();
  await page.waitForURL('**/drama-studio?step=5');
  await waitForVideoLibrary();
  await page.goBack();
  await page.waitForURL('**/drama-studio/info');
  await page.reload();
  await page.getByRole('heading', { name: 'Production Info', exact: true }).waitFor();
  await page.goBack();
  await page.waitForURL('**/drama-studio?step=5');
  await waitForVideoLibrary();
  await assetButton().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/drama-studio/assets');
  await page.getByRole('heading', { name: 'Asset Library', exact: true }).waitFor();
  assert.equal(await assetButton().getAttribute('aria-current'), 'page');
  await navigation().getByRole('link', { name: 'Creative Brief', exact: true }).click();
  await page.waitForURL('**/drama-studio?step=1');
  await page.getByRole('button', { name: 'Show Drama Studio pages' }).click();
  const menu = page.locator('.drama-menu:visible');
  assert.equal(await menu.getByRole('menuitem', { name: /Asset Library/ }).getAttribute('href'), '/drama-studio/assets');
  await menu.getByRole('menuitem', { name: /Production Info/ }).click();
  await page.waitForURL('**/drama-studio/info');
  await page.getByRole('heading', { name: 'Production Info', exact: true }).waitFor();
  assert.equal(generationCalls, 0, 'Navigation must never submit provider work');
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS Production Info tab/menu/empty-state destination and history; separate Asset Library button, keyboard access, global menu, responsive layouts and no generation calls');
})().catch(error => { console.error(error); process.exit(1); });
