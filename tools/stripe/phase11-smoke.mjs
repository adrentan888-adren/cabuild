import crypto from "crypto";
import fs from "fs/promises";
import http from "http";
import { spawn } from "child_process";

const appPort = 3104;
const stripePort = 3211;
const appBase = `http://127.0.0.1:${appPort}`;
const webhookBase = "https://contentagent-api.example.test";
const testDataFile = ".next/phase11-test-data.json";
const secrets = { test: "whsec_phase11_test", live: "whsec_phase11_live" };
const endpoints = new Map();
let productCount = 0;
let priceCount = 0;
let checkoutCount = 0;

await fs.rm(testDataFile, { force: true });
const stripeServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  const path = req.url || "";
  const token = String(req.headers.authorization || "");
  const mode = token.includes("_live_") ? "live" : "test";
  if (req.method === "GET" && path === "/v1/account") return json(res, 200, { id: `acct_phase11_${mode}`, country: "MY", default_currency: "usd", charges_enabled: true, payouts_enabled: true, business_profile: { name: `Content Agent ${mode}` } });
  if (req.method === "POST" && path === "/v1/webhook_endpoints") {
    const id = `we_phase11_${mode}`;
    endpoints.set(id, { url: body.get("url"), status: "enabled" });
    return json(res, 200, { id, secret: secrets[mode], url: body.get("url"), status: "enabled" });
  }
  if (req.method === "GET" && path.startsWith("/v1/webhook_endpoints/")) {
    const id = path.split("/").pop();
    return json(res, 200, { id, ...(endpoints.get(id) || {}), status: "enabled" });
  }
  if (req.method === "POST" && path === "/v1/products") return json(res, 200, { id: `prod_${mode}_${++productCount}` });
  if (req.method === "POST" && path.startsWith("/v1/products/")) return json(res, 200, { id: path.split("/").pop(), name: body.get("name") });
  if (req.method === "POST" && path === "/v1/prices") return json(res, 200, { id: `price_${mode}_${++priceCount}` });
  if (req.method === "POST" && path.startsWith("/v1/prices/")) return json(res, 200, { id: path.split("/").pop(), active: false });
  if (req.method === "POST" && path === "/v1/customers") return json(res, 200, { id: `cus_phase11_${mode}_${body.get("metadata[userId]")}` });
  if (req.method === "POST" && path === "/v1/checkout/sessions") return json(res, 200, { id: `cs_phase11_${mode}_${++checkoutCount}`, url: `https://checkout.stripe.test/${mode}/${checkoutCount}` });
  if (req.method === "POST" && path === "/v1/billing_portal/sessions") return json(res, 200, { id: `bps_phase11_${mode}`, url: `https://billing.stripe.test/${mode}` });
  return json(res, 404, { error: { message: `Unhandled mock Stripe route: ${req.method} ${path}` } });
});
await listen(stripeServer, stripePort);

const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATA_STORE_PROVIDER: "",
    DATA_STORE_GCS_BUCKET: "",
    DATA_STORE_LOCAL_FILE: testDataFile,
    STRIPE_API_BASE_URL: `http://127.0.0.1:${stripePort}/v1`,
    STRIPE_WEBHOOK_BASE_URL: webhookBase,
    STRIPE_LIVE_SETUP_ENABLED: "true",
    APP_SECRET: "phase11-test-secret"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let appOutput = "";
app.stdout.on("data", (chunk) => { appOutput += chunk.toString(); });
app.stderr.on("data", (chunk) => { appOutput += chunk.toString(); });

try {
  step("Waiting for isolated Content Agent server");
  await waitFor(`${appBase}/api/healthz`);
  const ownerCookie = await login("demo@contentagent.tech", "demo1234");

  step("Confirming live account connection is blocked before readiness approval");
  const earlyConnect = await request("POST", "/api/admin/stripe", ownerCookie, { operation: "connect", mode: "live", secretKey: "sk_live_phase11", publishableKey: "pk_live_phase11", confirmation: "CONNECT LIVE STRIPE" });
  assert(earlyConnect.status === 400, "Live connection was allowed before readiness approval.");

  step("Saving and approving all live-readiness prerequisites");
  const initial = await getJson("/api/admin/stripe", ownerCookie);
  const readiness = initial.liveLaunchControl.readiness.map((item) => ({ key: item.key, confirmed: true, note: `Phase 11 automated evidence: ${item.key}` }));
  await api("/api/admin/stripe", ownerCookie, { operation: "updateLiveReadiness", mode: "live", readiness });
  await api("/api/admin/stripe", ownerCookie, { operation: "approveLiveReadiness", mode: "live", confirmation: "APPROVE LIVE READINESS" });

  step("Connecting live Stripe and provisioning an isolated live webhook");
  const connected = await api("/api/admin/stripe", ownerCookie, { operation: "connect", mode: "live", secretKey: "sk_live_phase11", publishableKey: "pk_live_phase11", confirmation: "CONNECT LIVE STRIPE" });
  const liveConnection = connected.connections.find((item) => item.mode === "live");
  assert(liveConnection?.status === "connected" && liveConnection.webhookUrl === `${webhookBase}/api/stripe/webhook/live`, "Live connection or webhook isolation failed.");

  step("Synchronizing and approving all eight live catalogue offers");
  const synced = await api("/api/admin/stripe", ownerCookie, { operation: "syncCatalogue", mode: "live", subscriptionPolicy: "new_customers_only", confirmation: "SYNC LIVE CATALOGUE" });
  assert(synced.catalogueMappings.filter((item) => item.mode === "live" && item.active && item.status === "synced").length === 8, "Expected eight synchronized live mappings.");
  await api("/api/admin/stripe", ownerCookie, { operation: "approveLiveCatalogue", mode: "live", confirmation: "APPROVE LIVE CATALOGUE" });
  await api("/api/admin/stripe", ownerCookie, { operation: "updateLiveRollout", mode: "live", stage: "owner_only", allowlistedUserIds: [] });
  const preflight = await api("/api/admin/stripe", ownerCookie, { operation: "runLivePreflight", mode: "live" }, [200, 207]);
  assert(preflight.preflight?.passed, `Live preflight failed: ${JSON.stringify(preflight.preflight?.checks)}`);
  await api("/api/admin/stripe", ownerCookie, { operation: "toggleCheckout", mode: "live", enabled: true, confirmation: "ENABLE LIVE CHECKOUT" });
  await patchBilling(ownerCookie, { operation: "updateSettings", stripeMode: "live" });

  step("Running owner-only top-up and subscription Checkout flows");
  const topUpCheckout = await api("/api/billing/checkout", ownerCookie, { kind: "package", itemId: "pkg_mini_5", returnUrl: appBase });
  const planCheckout = await api("/api/billing/checkout", ownerCookie, { kind: "plan", itemId: "plan_starter_20", returnUrl: appBase });
  const billingBeforeEvents = await getJson("/api/admin/billing", ownerCookie);
  const topUpOrder = billingBeforeEvents.stripeCheckoutOrders.find((item) => item.id === topUpCheckout.orderId);
  const planOrder = billingBeforeEvents.stripeCheckoutOrders.find((item) => item.id === planCheckout.orderId);
  assert(topUpOrder?.mode === "live" && planOrder?.mode === "live", "Owner Checkout did not use live catalogue snapshots.");

  await sendWebhook("live", {
    id: "evt_phase11_topup",
    type: "checkout.session.completed",
    livemode: true,
    created: nowSeconds(),
    data: { object: { id: topUpCheckout.sessionId, customer: "cus_phase11_live_usr_demo", payment_intent: "pi_phase11_topup", metadata: orderMetadata(topUpOrder) } }
  });
  await sendWebhook("live", {
    id: "evt_phase11_plan_checkout",
    type: "checkout.session.completed",
    livemode: true,
    created: nowSeconds(),
    data: { object: { id: planCheckout.sessionId, customer: "cus_phase11_live_usr_demo", subscription: "sub_phase11_owner", metadata: orderMetadata(planOrder) } }
  });
  const invoiceEvent = {
    id: "evt_phase11_invoice",
    type: "invoice.paid",
    livemode: true,
    created: nowSeconds(),
    data: { object: {
      id: "in_phase11_owner",
      customer: "cus_phase11_live_usr_demo",
      subscription: "sub_phase11_owner",
      status: "paid",
      metadata: orderMetadata(planOrder),
      lines: { data: [{ price: { id: planOrder.stripePriceId }, period: { start: nowSeconds(), end: nowSeconds() + 2592000 } }] }
    } }
  };
  await sendWebhook("live", invoiceEvent);
  const duplicate = await sendWebhook("live", invoiceEvent);
  assert(duplicate.body.duplicate === true, "Live duplicate webhook was not suppressed.");
  const portal = await api("/api/billing/portal", ownerCookie, { returnUrl: appBase });
  assert(portal.url === "https://billing.stripe.test/live", "Live Customer Portal did not open.");
  await sendWebhook("live", {
    id: "evt_phase11_cancel",
    type: "customer.subscription.updated",
    livemode: true,
    created: nowSeconds(),
    data: { object: { id: "sub_phase11_owner", customer: "cus_phase11_live_usr_demo", status: "active", cancel_at_period_end: true, metadata: { userId: "usr_demo", workspaceId: "ws_demo", itemId: "plan_starter_20", catalogueRevisionId: planOrder.catalogueRevisionId }, items: { data: [{ price: { id: planOrder.stripePriceId } }] } } }
  });
  await sendWebhook("live", {
    id: "evt_phase11_refund",
    type: "charge.refunded",
    livemode: true,
    created: nowSeconds(),
    data: { object: { id: "ch_phase11_topup", payment_intent: "pi_phase11_topup", amount: 500, amount_refunded: 500 } }
  });

  step("Verifying owner-only access blocks a normal user");
  const createdUser = await api("/api/admin/users", ownerCookie, { email: "phase11-user@example.test", name: "Phase 11 User", password: "phase11pass", role: "user", emailVerified: true });
  const userCookie = await login("phase11-user@example.test", "phase11pass");
  const blocked = await request("POST", "/api/billing/checkout", userCookie, { kind: "package", itemId: "pkg_mini_5", returnUrl: appBase });
  assert(blocked.status === 403 && blocked.body.rolloutStage === "owner_only", "Normal user bypassed owner-only live rollout.");

  step("Recording and approving the redacted owner smoke-test report");
  const billingAfterEvents = await getJson("/api/admin/billing", ownerCookie);
  const reportLedger = billingAfterEvents.ledger.filter((entry) => String(entry.metadata?.stripeMode || "") === "live" && ["purchase", "subscription_grant", "refund"].includes(entry.type));
  assert(reportLedger.filter((entry) => entry.type === "purchase").length === 1, "Top-up credits were not granted exactly once.");
  assert(reportLedger.filter((entry) => entry.type === "subscription_grant").length === 1, "Subscription credits were not granted exactly once.");
  assert(reportLedger.filter((entry) => entry.type === "refund").length === 1, "Refund reversal was not recorded exactly once.");
  const savedReport = await api("/api/admin/stripe", ownerCookie, {
    operation: "saveLiveLaunchReport",
    mode: "live",
    topUpOrderId: topUpCheckout.orderId,
    subscriptionOrderId: planCheckout.orderId,
    stripePaymentIntentId: "pi_phase11_topup",
    stripeSubscriptionId: "sub_phase11_owner",
    ledgerEntryIds: reportLedger.map((entry) => entry.id),
    checks: { topUpCreditsCorrect: true, subscriptionCreditsCorrect: true, receiptConfirmed: true, portalConfirmed: true, cancellationConfirmed: true, refundConfirmed: true, duplicateWebhookConfirmed: true },
    notes: "Automated Phase 11 smoke report with redacted payment data."
  });
  await api("/api/admin/stripe", ownerCookie, { operation: "approveLiveLaunchReport", mode: "live", reportId: savedReport.reportId, confirmation: "APPROVE LIVE SMOKE TEST" });

  step("Expanding to an allowlist, then exercising emergency stop");
  await api("/api/admin/stripe", ownerCookie, { operation: "updateLiveRollout", mode: "live", stage: "allowlist", allowlistedUserIds: [createdUser.user.id] });
  const allowlistedCheckout = await api("/api/billing/checkout", userCookie, { kind: "package", itemId: "pkg_small_10", returnUrl: appBase });
  assert(allowlistedCheckout.orderId, "Allowlisted user could not open live Checkout.");
  await api("/api/admin/stripe", ownerCookie, { operation: "emergencyStopLive", mode: "live", reason: "Automated rollback drill", confirmation: "STOP LIVE CHECKOUT" });
  const stopped = await request("POST", "/api/billing/checkout", userCookie, { kind: "package", itemId: "pkg_small_10", returnUrl: appBase });
  assert(stopped.status === 503 || stopped.status === 403, "Emergency stop did not block new live Checkout.");
  const afterStopWebhook = await sendWebhook("live", { id: "evt_phase11_after_stop", type: "payment_intent.succeeded", livemode: true, created: nowSeconds(), data: { object: { id: "pi_after_stop" } } });
  assert(afterStopWebhook.status === 200, "Emergency stop incorrectly disabled live webhook ingestion.");

  const finalState = await getJson("/api/admin/stripe", ownerCookie);
  assert(finalState.liveLaunchControl.checkoutKillSwitch === true, "Live kill switch is not armed after emergency stop.");
  assert(finalState.liveLaunchReports.some((report) => report.status === "approved"), "Approved launch report is missing.");
  assert(finalState.catalogueMappings.filter((item) => item.mode === "live" && item.active).length === 8, "Live catalogue changed during rollout tests.");

  process.stdout.write(JSON.stringify({
    ok: true,
    readinessApproved: true,
    liveAccount: liveConnection.accountId,
    liveMappings: 8,
    preflightPassed: true,
    ownerTopUpCreditsGrantedOnce: true,
    ownerSubscriptionCreditsGrantedOnce: true,
    refundReconciled: true,
    duplicateWebhookIgnored: true,
    ownerOnlyBlockedNormalUser: true,
    allowlistAllowedSelectedUser: true,
    launchReportApproved: true,
    emergencyStopBlockedCheckout: true,
    webhookPreservedAfterStop: true
  }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n${appOutput}\n`);
  process.exitCode = 1;
} finally {
  app.kill("SIGTERM");
  await new Promise((resolve) => stripeServer.close(resolve));
  await fs.rm(testDataFile, { force: true });
}

function orderMetadata(order) {
  return { orderId: order.id, catalogueRevisionId: order.catalogueRevisionId, stripeMode: "live", userId: order.userId, workspaceId: order.workspaceId, purchaseKind: order.itemKind, itemId: order.itemId, credits: String(order.creditsPromised) };
}

async function login(email, password) {
  const res = await fetch(`${appBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(5000) });
  assert(res.ok, `Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0] || "";
  assert(cookie, `Login cookie missing for ${email}.`);
  return cookie;
}

async function api(path, cookie, body, accepted = [200]) {
  const result = await request("POST", path, cookie, body);
  if (!accepted.includes(result.status)) throw new Error(`${path} failed with ${result.status}: ${result.body.error || JSON.stringify(result.body)}`);
  return result.body;
}

async function patchBilling(cookie, body) {
  const result = await request("PATCH", "/api/admin/billing", cookie, body);
  if (result.status !== 200) throw new Error(`Billing PATCH failed with ${result.status}: ${result.body.error || JSON.stringify(result.body)}`);
  return result.body;
}

async function request(method, path, cookie, body) {
  const res = await fetch(`${appBase}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getJson(path, cookie) {
  const res = await fetch(`${appBase}${path}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} failed with ${res.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

async function sendWebhook(mode, event) {
  const payload = JSON.stringify(event);
  const timestamp = nowSeconds();
  const signature = crypto.createHmac("sha256", secrets[mode]).update(`${timestamp}.${payload}`).digest("hex");
  const res = await fetch(`${appBase}/api/stripe/webhook/${mode}`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body: payload, signal: AbortSignal.timeout(5000) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function step(message) { process.stdout.write(`[stripe-phase11] ${message}\n`); }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
