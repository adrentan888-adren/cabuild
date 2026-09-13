const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const base = process.env.UAT_BASE_URL || 'http://localhost:3100';
  const errors = [], mutations = [];
  let failed = false, malformed = false, requests = 0, scope = 'owner-a';
  const summary = () => ({
    user: { id: scope, name: 'Balance UAT', email: 'balance@example.test', role: 'owner' },
    workspace: { id: 'workspace-a', name: 'Production', plan: 'Pro', credits: 1234 },
    providers: [
      { id: 'kie', label: 'KIE AI', configured: true, credits: 987.5, unit: 'credits', message: 'Live provider balance' },
      { id: 'apify', label: 'Apify', configured: true, credits: 17.25, unit: 'USD', message: '$32.75 of $50.00 used this cycle' },
      { id: 'apifyBackup', label: 'Apify backup', configured: true, credits: null, unit: null, message: 'Balance temporarily unavailable' },
      { id: 'uploadPost', label: 'Upload-Post', configured: false, credits: null, unit: null, message: 'API key not configured' },
    ],
    checkedAt: '2026-09-13T10:00:00Z',
  });
  const guard = route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/account/credits') {
      requests++;
      return route.fulfill(failed ? { status: 503, body: 'Temporarily unavailable' } : malformed ? { json: {} } : { json: summary() });
    }
    if (/credits|credentials|integrations/.test(path)) return route.fulfill({ json: { credits: 1000, configured: false } });
    if (path === '/api/drama/brief-jobs') return route.fulfill({ json: { ok: true, jobs: [] } });
    if (request.method() !== 'GET' && path !== '/api/auth/login') {
      mutations.push(path);
      return route.fulfill({ status: 403, json: { error: 'No-spend UAT' } });
    }
    return route.continue();
  };
  await context.route('**/api/**', guard);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await page.goto(base + '/drama-studio?step=1');
  const trigger = () => page.getByRole('button', { name: 'Show credit balances', exact: true });
  const panel = () => page.locator('.credit-popover');
  const open = async () => {
    await page.mouse.move(0, 700);
    await trigger().focus();
    if (await trigger().getAttribute('aria-expanded') !== 'true') await page.keyboard.press('Enter');
    await panel().waitFor({ state: 'visible' });
  };
  await trigger().waitFor();
  await open();
  await panel().getByRole('radio', { name: 'Show KIE AI in header' }).waitFor();
  assert.match(await panel().innerText(), /1,234 CA credits/);
  assert.match(await panel().innerText(), /17.25 USD/);
  assert.match(await panel().innerText(), /\$32.75 of \$50.00 used this cycle/);
  assert.match(await panel().innerText(), /Balance temporarily unavailable/);
  assert.match(await panel().innerText(), /Checked/);
  assert.match(await panel().innerText(), /Workspace credits/);
  assert.match(await panel().innerText(), /Provider credits/);
  assert.match(await panel().innerText(), /Remaining monthly allowance/);
  assert.match(await panel().innerText(), /Connection status/);
  const initialGeometry = await panel().evaluate(element => ({ height: element.getBoundingClientRect().height, contentHeight: element.scrollHeight }));
  assert(initialGeometry.height <= 550, `All five balances fit a compact desktop popover: ${JSON.stringify(initialGeometry)}`);
  assert(initialGeometry.contentHeight <= initialGeometry.height + 2, 'Desktop balance details do not need an inner scrollbar');
  const countBeforeChoice = requests;
  await panel().getByRole('radio', { name: 'Show KIE AI in header' }).check();
  assert.match(await trigger().innerText(), /KIE AI.*987.5 credits/s);
  assert.equal(requests, countBeforeChoice, 'Pinning is local and does not fetch balances');
  await page.keyboard.press('Escape');
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false');
  assert(await trigger().evaluate(element => document.activeElement === element));
  await page.reload();
  await open();
  await panel().getByRole('radio', { name: 'Show KIE AI in header' }).waitFor();
  await page.waitForFunction(() => document.querySelector('input[value="kie"]')?.checked);
  assert.match(await trigger().innerText(), /987.5 credits/);
  await panel().getByRole('radio', { name: 'Show Apify in header' }).check();
  assert.match(await trigger().innerText(), /Apify.*17.25 USD/s);
  failed = true;
  await panel().getByRole('button', { name: 'Refresh credit balances' }).click();
  await page.getByText('Could not refresh. Displayed balances may be out of date.').waitFor();
  assert.match(await trigger().innerText(), /Last known.*17.25 USD/s);
  failed = false; malformed = true;
  await panel().getByRole('button', { name: 'Refresh credit balances' }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh credit balances"]').disabled);
  assert.match(await trigger().innerText(), /Last known/);
  malformed = false;
  await panel().getByRole('button', { name: 'Refresh credit balances' }).click();
  await page.waitForFunction(() => !document.querySelector('.credit-update-error'));
  assert.doesNotMatch(await trigger().innerText(), /Last known/);
  await panel().getByRole('radio', { name: 'Show Apify backup in header' }).check();
  assert.match(await trigger().innerText(), /Unavailable/);
  assert.doesNotMatch(await trigger().innerText(), /0 credits/);
  await panel().getByRole('radio', { name: 'Show KIE AI in header' }).check();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await open();
    const box = await panel().boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width + 1, `Popover fits ${width}`);
    const rowGeometry = await panel().locator('.credit-balance-choice').evaluateAll(rows => rows.map(row => ({
      height: row.getBoundingClientRect().height,
      nameSize: parseFloat(getComputedStyle(row.querySelector('b')).fontSize),
      balanceSize: parseFloat(getComputedStyle(row.querySelector('strong')).fontSize),
      detailSize: parseFloat(getComputedStyle(row.querySelector('small')).fontSize),
      headingHeight: row.querySelector('.credit-balance-heading').getBoundingClientRect().height,
    })));
    assert(rowGeometry.every(row => row.height >= 44 && row.height <= 110), `Compact touchable balance rows at ${width}: ${JSON.stringify(rowGeometry)}`);
    assert(rowGeometry.every(row => row.nameSize >= 14 && row.balanceSize >= 15 && row.detailSize >= 12), `Readable amounts and details at ${width}`);
    if (width >= 768) assert(rowGeometry.every(row => row.headingHeight <= 22), `Provider and amount share one line at ${width}`);
    assert(await trigger().locator('.credit-pinned-label').isVisible(), `Pinned value visible ${width}`);
    const pinned = await trigger().locator('.credit-pinned-label').boundingBox();
    assert(pinned.width >= 75, `Pinned amount has readable width at ${width}: ${pinned.width}`);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.global-header *')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && box.height && getComputedStyle(element).visibility !== 'hidden' && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible';
    }).map(element => element.className));
    assert.deepEqual(overflow, [], `No header overflow ${width}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No document overflow ${width}`);
    await page.screenshot({ path: `.playwright-mcp/header-credits-${width}.png` });
  }
  scope = 'owner-b';
  await page.reload(); await open();
  await panel().getByRole('radio', { name: 'Show KIE AI in header' }).waitFor();
  assert.match(await trigger().innerText(), /Content Agent.*1,234 CA credits/s);
  scope = 'owner-a';
  await page.reload(); await open();
  await page.waitForFunction(() => document.querySelector('input[value="kie"]')?.checked);
  assert.match(await trigger().innerText(), /KIE AI/);
  await panel().getByRole('radio', { name: 'Show KIE AI in header' }).focus();
  await page.keyboard.press('ArrowDown');
  assert(await panel().getByRole('radio', { name: 'Show Apify in header' }).isChecked(), 'Native keyboard radio navigation updates the pinned balance');
  const touch = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 320, height: 900 }, hasTouch: true, isMobile: true });
  await touch.route('**/api/**', guard);
  const phone = await touch.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(base + '/drama-studio?step=1');
  await phone.getByRole('button', { name: 'Show credit balances', exact: true }).tap();
  await phone.locator('.credit-popover').getByRole('radio', { name: 'Show KIE AI in header' }).tap();
  assert.match(await phone.getByRole('button', { name: 'Show credit balances', exact: true }).innerText(), /KIE AI.*987.5 credits/s);
  console.log('Compact five-balance desktop geometry:', JSON.stringify(initialGeometry));
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  console.log('PASS compact credit details, exact units, preference persistence/owner isolation, failures/recovery, keyboard/touch and 1440/768/390/320 layouts; no mutations or paid requests');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
