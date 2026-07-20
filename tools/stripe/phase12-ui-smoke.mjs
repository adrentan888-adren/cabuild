import fs from "fs/promises";
import { execFileSync, spawn } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

const appPort = 3107;
const appBase = `http://127.0.0.1:${appPort}`;
const testDataFile = ".next/phase12-ui-test-data.json";
const npmRoot = globalNodeModulesPath();
const { chromium } = await import(pathToFileURL(path.join(npmRoot, "playwright", "index.mjs")).href);
await fs.rm(testDataFile, { force: true });
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)], { cwd: process.cwd(), env: { ...process.env, DATA_STORE_PROVIDER: "", DATA_STORE_GCS_BUCKET: "", DATA_STORE_LOCAL_FILE: testDataFile, APP_SECRET: "phase12-ui-secret", APP_SURFACE: "combined" }, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; app.stdout.on("data", (chunk) => { output += chunk.toString(); }); app.stderr.on("data", (chunk) => { output += chunk.toString(); });
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
  const errors = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(error.message));
  const login = await page.request.post(`${appBase}/api/auth/login`, { data: { email: "demo@contentagent.tech", password: "demo1234" } });
  assert(login.ok(), "Browser login failed.");
  await page.goto(`${appBase}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await page.getByRole("button", { name: "Finance", exact: true }).click();
  await page.getByText("Finance and reconciliation", { exact: true }).waitFor();
  await page.getByText("How totals are calculated", { exact: true }).waitFor();
  await page.getByText("Finance alert thresholds", { exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Reconcile Stripe", exact: true }).isVisible(), "Reconciliation control is missing.");
  assert(await page.getByText("Period close", { exact: true }).isVisible(), "Period close controls are missing.");
  await page.screenshot({ path: ".next/phase12-finance-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".next/phase12-finance-mobile.png", fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!overflow, "Finance admin page causes horizontal overflow on mobile.");
  assert(!errors.length, `Browser errors: ${errors.join(" | ")}`);
  process.stdout.write(JSON.stringify({ ok: true, financeDashboard: true, definitions: true, reconciliationControl: true, closeControl: true, mobileOverflow: false, desktopScreenshot: ".next/phase12-finance-desktop.png", mobileScreenshot: ".next/phase12-finance-mobile.png" }, null, 2) + "\n");
} catch (error) { process.stderr.write(`${error instanceof Error ? error.stack : error}\n${output}\n`); process.exitCode = 1; }
finally { if (browser) await browser.close(); app.kill("SIGTERM"); await fs.rm(testDataFile, { force: true }); }
async function waitFor(url) { for (let attempt = 0; attempt < 100; attempt += 1) { try { const res = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error(`Timed out waiting for ${url}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
