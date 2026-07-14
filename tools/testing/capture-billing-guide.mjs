import fs from "fs/promises";
import { execFileSync } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

const frontendBase = process.env.TEST_FRONTEND_URL || "https://contentagent-social-staging-mkhae4sjlq-as.a.run.app";
const adminBase = process.env.TEST_ADMIN_URL || "https://contentagent-admin-staging-mkhae4sjlq-as.a.run.app";
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!email || !password) throw new Error("Set TEST_EMAIL and TEST_PASSWORD before capturing tutorial screenshots.");

const outputDir = path.resolve("docs/testing/screenshots");
await fs.mkdir(outputDir, { recursive: true });
const npmRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(npmRoot, "playwright", "index.mjs")).href);
const browser = await chromium.launch({ headless: true });
const manifest = [];

try {
  const frontend = await authenticatedPage(frontendBase);
  await frontend.page.goto(frontendBase, { waitUntil: "networkidle" });
  await capture(frontend.page, "01_frontend_navigation.png", "Frontend modules", [
    [frontend.page.getByRole("button", { name: "Research", exact: true }), "1. Research and Apify billing"],
    [frontend.page.getByRole("button", { name: "Create Content", exact: true }), "2. Content generation billing"],
    [frontend.page.getByRole("button", { name: "Billing", exact: true }), "3. User balance and usage"]
  ]);

  await openFrontend(frontend.page, "Create Content", "Create content");
  await capture(frontend.page, "02_create_content.png", "Create Content test area", [
    [frontend.page.getByRole("heading", { name: "Create content", exact: true }), "1. Select content type and settings"],
    [frontend.page.getByRole("button", { name: /Fill fields with AI/i }).first(), "2. Test AI field-fill quote"],
    [frontend.page.getByRole("button", { name: /^Generate/i }).last(), "3. Verify final generation quote"]
  ]);

  const finalGenerate = frontend.page.getByRole("button", { name: /^Generate/i }).last();
  await finalGenerate.scrollIntoViewIfNeeded();
  await capture(frontend.page, "02b_create_content_generate.png", "Create Content final action", [
    [finalGenerate, "1. Confirm the displayed credit charge"],
    [finalGenerate, "2. Click only for an approved paid test"]
  ]);

  await openFrontend(frontend.page, "Research", "Find competitor posts worth turning into content");
  await capture(frontend.page, "03_research.png", "Research billing tests", [
    [frontend.page.getByRole("button", { name: /Search by URL/i }), "1. URL-scoped scan"],
    [frontend.page.getByRole("button", { name: /Search by keywords/i }), "2. Keyword scan"],
    [frontend.page.getByRole("button", { name: "History", exact: true }), "3. Cache/history no-charge test"]
  ]);

  await openFrontend(frontend.page, "Persona", "Reference persona");
  await capture(frontend.page, "04_persona.png", "Persona crawl and AI mapping", [
    [frontend.page.getByRole("button", { name: "Auto-fill", exact: true }), "1. Open public profile sources"],
    [frontend.page.getByText("Prompt voice source", { exact: true }), "2. Review the saved active profile"]
  ]);

  await openFrontend(frontend.page, "Automation", "Source Watcher");
  await capture(frontend.page, "05_automation.png", "Automation billing controls", [
    [frontend.page.getByRole("button", { name: "Source Watcher", exact: true }), "1. Crawl best-performing sources"],
    [frontend.page.getByRole("button", { name: "Scheduled Content", exact: true }), "2. Schedule generated content"],
    [frontend.page.getByText(/Maximum credits per run/i).first(), "3. Verify per-run spending cap"]
  ]);

  await openFrontend(frontend.page, "Billing", "Credits, plans, and usage");
  await capture(frontend.page, "06_user_billing.png", "User Billing dashboard", [
    [frontend.page.getByRole("heading", { name: "Credits, plans, and usage", exact: true }), "1. Record starting balance"],
    [frontend.page.getByText("Usage by module", { exact: true }), "2. Compare usage to ledger"],
    [frontend.page.getByText("Plans", { exact: true }).first(), "3. Test subscriptions and top-ups"]
  ]);
  await frontend.context.close();

  const admin = await authenticatedPage(adminBase);
  await admin.page.goto(`${adminBase}/admin`, { waitUntil: "networkidle" });
  await admin.page.getByRole("button", { name: "Billing", exact: true }).click();
  await admin.page.getByRole("button", { name: "Billing Plans", exact: true }).waitFor();
  await capture(admin.page, "07_admin_billing_modules.png", "Admin Billing modules", [
    [admin.page.getByRole("button", { name: "Billing Plans", exact: true }), "1. Plans and packages"],
    [admin.page.getByRole("button", { name: "Rate Cards", exact: true }), "2. Provider cost and markup"],
    [admin.page.getByRole("button", { name: "Stripe Connection", exact: true }), "3. Stripe test/live setup"],
    [admin.page.getByRole("button", { name: "Finance", exact: true }), "4. Reconciliation and close"]
  ]);

  await openAdminBilling(admin.page, "User Billing", "User billing");
  await capture(admin.page, "08_admin_user_billing.png", "Manual credit adjustment", [
    [admin.page.getByText("User billing", { exact: true }).first(), "1. Confirm current user balance"],
    [admin.page.getByText("Adjust user credits", { exact: true }), "2. Add/remove credits with reason"],
    [admin.page.getByRole("button", { name: "Save adjustment", exact: true }), "3. Save and verify ledger"]
  ]);

  await openAdminBilling(admin.page, "Billing Rules", "Billing rules");
  await capture(admin.page, "09_billing_rules.png", "Rules and quote tester", [
    [admin.page.getByText("Billing rules", { exact: true }).first(), "1. Configure limits and refund policy"],
    [admin.page.getByText("Quote tester", { exact: true }), "2. Enter action/model/duration"],
    [admin.page.getByRole("button", { name: "Calculate quote", exact: true }), "3. Verify backend quote"]
  ]);

  await openAdminBilling(admin.page, "Pricing Alerts", "Provider pricing sync");
  await capture(admin.page, "10_pricing_sync.png", "Provider pricing review", [
    [admin.page.getByText("Provider pricing sync", { exact: true }), "1. Review latest sync runs"],
    [admin.page.getByRole("button", { name: "Sync Kie pricing", exact: true }), "2. Network test; may contact provider"],
    [admin.page.getByRole("button", { name: "Sync Apify pricing", exact: true }), "3. Review before applying rates"]
  ]);

  await openAdminBilling(admin.page, "Stripe Connection", "Payment environment");
  await capture(admin.page, "11_stripe_connection.png", "Stripe test-mode setup", [
    [admin.page.getByText("Payment environment", { exact: true }), "1. Keep environment on Test"],
    [admin.page.getByText("Test account", { exact: true }), "2. Validate account and webhook"],
    [admin.page.getByRole("button", { name: /Sync catalogue/i }).first(), "3. Sync 3 plans and 5 packages"]
  ]);

  await openAdminBilling(admin.page, "Live Launch", "Phase 11 readiness");
  await capture(admin.page, "12_live_launch.png", "Controlled live launch", [
    [admin.page.getByText("Phase 11 readiness", { exact: true }), "1. Complete every readiness check"],
    [admin.page.getByText("Test and live catalogue comparison", { exact: true }), "2. Confirm all offers match"],
    [admin.page.getByText("Controlled rollout", { exact: true }), "3. Start owner-only; keep kill switch"]
  ]);

  await openAdminBilling(admin.page, "Credit Ledger", "Credit ledger");
  await capture(admin.page, "13_credit_ledger.png", "Ledger verification", [
    [admin.page.getByText("Credit ledger", { exact: true }), "1. Filter by module/provider/user"],
    [admin.page.getByLabel("Module"), "2. Trace reservation and settlement"],
    [admin.page.getByLabel("User"), "3. Compare against user balance"]
  ]);

  await openAdminBilling(admin.page, "Finance", "Finance and reconciliation");
  await capture(admin.page, "14_finance.png", "Finance and reconciliation", [
    [admin.page.getByRole("button", { name: "Reconcile Stripe", exact: true }), "1. Read-only Stripe reconciliation"],
    [admin.page.getByText("Reconciliation findings", { exact: true }), "2. Review and resolve findings"],
    [admin.page.getByText("Period close", { exact: true }), "3. Close only after review"]
  ]);
  await admin.context.close();

  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, outputDir, screenshots: manifest }, null, 2));
} finally {
  await browser.close();
}

async function authenticatedPage(base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const response = await context.request.post(`${base}/api/auth/login`, { data: { email, password } });
  if (!response.ok()) throw new Error(`Login failed for ${base}: HTTP ${response.status()}`);
  const page = await context.newPage();
  return { context, page };
}

async function openFrontend(page, buttonName, headingName) {
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await page.getByRole("heading", { name: headingName, exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function openAdminBilling(page, tabName, visibleText) {
  await page.getByRole("button", { name: tabName, exact: true }).click();
  await page.getByText(visibleText, { exact: true }).first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function capture(page, fileName, title, callouts) {
  await clearCallouts(page);
  for (const [locator, label] of callouts) await addCallout(page, locator, label);
  const destination = path.join(outputDir, fileName);
  await page.screenshot({ path: destination, fullPage: false });
  manifest.push({ file: fileName, title });
  await clearCallouts(page);
}

async function addCallout(page, locator, label) {
  const target = locator.first();
  if (!(await target.count()) || !(await target.isVisible().catch(() => false))) return;
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(({ box, label }) => {
    const overlay = document.createElement("div");
    overlay.dataset.testGuideCallout = "true";
    overlay.style.cssText = `position:fixed;left:${box.x - 3}px;top:${box.y - 3}px;width:${box.width + 6}px;height:${box.height + 6}px;border:3px solid #d92d20;border-radius:8px;z-index:2147483646;pointer-events:none;box-shadow:0 0 0 3px rgba(255,255,255,.88)`;
    const badge = document.createElement("div");
    badge.textContent = label;
    badge.style.cssText = "position:absolute;left:0;top:calc(100% + 7px);max-width:320px;background:#d92d20;color:#fff;font:700 13px/1.35 Arial,sans-serif;padding:7px 10px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.22);white-space:normal";
    overlay.appendChild(badge);
    document.body.appendChild(overlay);
  }, { box, label });
}

async function clearCallouts(page) {
  await page.evaluate(() => document.querySelectorAll('[data-test-guide-callout="true"]').forEach((item) => item.remove())).catch(() => undefined);
}
