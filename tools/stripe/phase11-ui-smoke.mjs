import fs from "fs/promises";
import { execFileSync, spawn } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

const appPort = 3105;
const appBase = `http://127.0.0.1:${appPort}`;
const testDataFile = ".next/phase11-ui-test-data.json";
const npmRoot = globalNodeModulesPath();
const { chromium } = await import(pathToFileURL(path.join(npmRoot, "playwright", "index.mjs")).href);

await fs.rm(testDataFile, { force: true });
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)], {
  cwd: process.cwd(),
  env: { ...process.env, DATA_STORE_PROVIDER: "", DATA_STORE_GCS_BUCKET: "", DATA_STORE_LOCAL_FILE: testDataFile, APP_SECRET: "phase11-ui-test-secret", APP_SURFACE: "combined", STRIPE_LIVE_SETUP_ENABLED: "true" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
app.stdout.on("data", (chunk) => { output += chunk.toString(); });
app.stderr.on("data", (chunk) => { output += chunk.toString(); });
let browser;

function globalNodeModulesPath() {
  if (process.platform === "win32") {
    const prefix = process.env.npm_config_prefix || path.join(process.env.APPDATA || "", "npm");
    return path.join(prefix, "node_modules");
  }
  return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
}

try {
  await waitFor(`${appBase}/api/healthz`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const login = await page.request.post(`${appBase}/api/auth/login`, { data: { email: "demo@contentagent.tech", password: "demo1234" } });
  assert(login.ok(), `Browser login failed with ${login.status()}.`);
  await page.goto(`${appBase}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await page.getByRole("button", { name: "Live Launch", exact: true }).click();
  await page.getByText("Phase 11 readiness", { exact: true }).waitFor();
  assert((await page.locator('.live-readiness-row input[type="checkbox"]').count()) === 10, "Expected ten live-readiness checks.");
  assert(await page.getByText("Test and live catalogue comparison", { exact: true }).isVisible(), "Catalogue comparison is missing.");
  assert(await page.getByText("Controlled rollout", { exact: true }).isVisible(), "Controlled rollout is missing.");
  assert(await page.getByText("Owner live smoke-test report", { exact: true }).isVisible(), "Smoke-test report is missing.");
  assert(await page.getByRole("button", { name: "Stop live Checkout", exact: true }).isVisible(), "Emergency stop is missing.");
  assert(await page.getByRole("button", { name: "Approve readiness", exact: true }).isDisabled(), "Readiness approval should be disabled before all checks are selected.");
  await page.screenshot({ path: ".next/phase11-admin-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".next/phase11-admin-mobile.png", fullPage: true });
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!bodyOverflow, "Phase 11 admin page causes horizontal overflow on mobile.");
  assert(errors.length === 0, `Browser errors detected: ${errors.join(" | ")}`);

  process.stdout.write(JSON.stringify({
    ok: true,
    readinessChecklist: true,
    catalogueComparison: true,
    controlledRollout: true,
    smokeReport: true,
    emergencyStop: true,
    mobilePageOverflow: false,
    desktopScreenshot: ".next/phase11-admin-desktop.png",
    mobileScreenshot: ".next/phase11-admin-mobile.png"
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
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function assert(condition, message) { if (!condition) throw new Error(message); }
