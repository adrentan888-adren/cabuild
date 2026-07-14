import fs from "fs/promises";
import { execFileSync, spawn } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

const appPort = 3103;
const appBase = `http://127.0.0.1:${appPort}`;
const testDataFile = ".next/phase10-5-ui-test-data.json";
const npmRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(npmRoot, "playwright", "index.mjs")).href);

await fs.rm(testDataFile, { force: true });
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATA_STORE_PROVIDER: "",
    DATA_STORE_GCS_BUCKET: "",
    DATA_STORE_LOCAL_FILE: testDataFile,
    APP_SECRET: "phase10-5-ui-test-secret",
    APP_SURFACE: "combined",
    STRIPE_LIVE_SETUP_ENABLED: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
app.stdout.on("data", (chunk) => { output += chunk.toString(); });
app.stderr.on("data", (chunk) => { output += chunk.toString(); });
let browser;

try {
  await waitFor(`${appBase}/api/healthz`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const login = await page.request.post(`${appBase}/api/auth/login`, { data: { email: "demo@contentagent.tech", password: "demo1234" } });
  assert(login.ok(), `Browser-context login failed with ${login.status()}.`);
  await page.goto(`${appBase}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await page.getByRole("button", { name: "Stripe Connection", exact: true }).click();
  await page.getByText("Test account", { exact: true }).waitFor();
  assert(await page.getByText("Live account", { exact: true }).isVisible(), "Live connection panel is missing.");
  assert(await page.locator('input[placeholder="sk_test_..."]').isVisible(), "Test secret-key input is missing.");
  assert(await page.locator('input[placeholder="sk_live_..."]').isDisabled(), "Live secret-key input should be locked during Phase 10.5.");
  assert((await page.getByText("Connect Stripe", { exact: true }).count()) >= 1, "Connect Stripe action is missing.");
  assert(await page.getByText(/Live setup will unlock in Phase 11/).isVisible(), "Phase 11 live lock guidance is missing.");
  assert(await page.getByText("Stripe catalogue", { exact: true }).isVisible(), "Stripe catalogue table is missing.");
  assert(await page.getByText("Checkout orders", { exact: true }).isVisible(), "Checkout order audit table is missing.");
  await page.screenshot({ path: ".next/phase10-5-admin-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "Billing Plans", exact: true }).click();
  assert((await page.getByText("Stripe price ID", { exact: true }).count()) === 0, "Manual Stripe Price ID field still appears in Billing Plans.");
  await page.getByRole("button", { name: "Stripe Connection", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".next/phase10-5-admin-mobile.png", fullPage: true });
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const overflowDetails = bodyOverflow ? await page.evaluate(() => Array.from(document.querySelectorAll("*")).map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { tag: element.tagName, className: String(element.className || ""), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), minWidth: style.minWidth, overflowX: style.overflowX };
  }).filter((item) => item.right > window.innerWidth + 2 && item.overflowX === "visible").slice(0, 12)) : [];
  assert(!bodyOverflow, `Stripe admin page causes horizontal page overflow on mobile: ${JSON.stringify(overflowDetails)}`);
  assert(errors.length === 0, `Browser errors detected: ${errors.join(" | ")}`);

  process.stdout.write(JSON.stringify({
    ok: true,
    testConnectionPanel: true,
    liveConnectionLocked: true,
    manualPriceIdRemoved: true,
    catalogueAuditVisible: true,
    checkoutOrdersVisible: true,
    mobilePageOverflow: false,
    desktopScreenshot: ".next/phase10-5-admin-desktop.png",
    mobileScreenshot: ".next/phase10-5-admin-mobile.png"
  }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n${output}\n`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  app.kill("SIGTERM");
  await fs.rm(testDataFile, { force: true });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
