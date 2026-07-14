import crypto from "crypto";
import fs from "fs/promises";
import http from "http";
import { spawn } from "child_process";

const appPort = 3106;
const stripePort = 3212;
const appBase = `http://127.0.0.1:${appPort}`;
const testDataFile = ".next/phase12-test-data.json";
const webhookSecret = "whsec_phase12_test";
const created = Math.floor(Date.now() / 1000);
let productCount = 0;
let priceCount = 0;

await fs.rm(testDataFile, { force: true });
const stripeServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  const url = new URL(req.url || "/", `http://127.0.0.1:${stripePort}`);
  const path = url.pathname;
  if (req.method === "GET" && path === "/v1/account") return json(res, 200, { id: "acct_phase12_test", country: "MY", default_currency: "usd", charges_enabled: true, payouts_enabled: true, business_profile: { name: "Content Agent Phase 12" } });
  if (req.method === "POST" && path === "/v1/webhook_endpoints") return json(res, 200, { id: "we_phase12", secret: webhookSecret, url: body.get("url"), status: "enabled" });
  if (req.method === "GET" && path === "/v1/webhook_endpoints/we_phase12") return json(res, 200, { id: "we_phase12", url: `${appBase}/api/stripe/webhook/test`, status: "enabled" });
  if (req.method === "POST" && path === "/v1/products") return json(res, 200, { id: `prod_phase12_${++productCount}` });
  if (req.method === "POST" && path.startsWith("/v1/products/")) return json(res, 200, { id: path.split("/").pop() });
  if (req.method === "POST" && path === "/v1/prices") return json(res, 200, { id: `price_phase12_${++priceCount}` });
  if (req.method === "POST" && path.startsWith("/v1/prices/")) return json(res, 200, { id: path.split("/").pop(), active: false });
  if (req.method === "POST" && path === "/v1/customers") return json(res, 200, { id: "cus_phase12" });
  if (req.method === "POST" && path === "/v1/checkout/sessions") return json(res, 200, { id: "cs_phase12", url: "https://checkout.stripe.test/phase12" });
  if (req.method === "GET" && path === "/v1/balance_transactions") return json(res, 200, { data: [
    { id: "txn_phase12_charge", amount: 500, fee: 45, net: 455, currency: "usd", type: "charge", reporting_category: "charge", status: "available", source: "ch_phase12", created, available_on: created + 86400 },
    { id: "txn_phase12_refund", amount: -500, fee: 0, net: -500, currency: "usd", type: "refund", reporting_category: "refund", status: "available", source: "re_phase12", created: created + 2, available_on: created + 86400 }
  ], has_more: false });
  if (req.method === "GET" && path === "/v1/charges/ch_phase12") return json(res, 200, { id: "ch_phase12", payment_intent: "pi_phase12" });
  if (req.method === "GET" && path === "/v1/refunds/re_phase12") return json(res, 200, { id: "re_phase12", charge: "ch_phase12", payment_intent: "pi_phase12" });
  return json(res, 404, { error: { message: `Unhandled mock Stripe route: ${req.method} ${url.pathname}${url.search}` } });
});
await listen(stripeServer, stripePort);

const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)], {
  cwd: process.cwd(),
  env: { ...process.env, DATA_STORE_PROVIDER: "", DATA_STORE_GCS_BUCKET: "", DATA_STORE_LOCAL_FILE: testDataFile, STRIPE_API_BASE_URL: `http://127.0.0.1:${stripePort}/v1`, STRIPE_WEBHOOK_BASE_URL: appBase, APP_SECRET: "phase12-test-secret" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
app.stdout.on("data", (chunk) => { output += chunk.toString(); });
app.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  step("Waiting for isolated server and signing in");
  await waitFor(`${appBase}/api/healthz`);
  const cookie = await login();

  step("Connecting Stripe test mode and creating a paid top-up");
  await api("/api/admin/stripe", cookie, { operation: "connect", mode: "test", secretKey: "sk_test_phase12", publishableKey: "pk_test_phase12" });
  await api("/api/admin/stripe", cookie, { operation: "syncCatalogue", mode: "test", subscriptionPolicy: "new_customers_only" });
  await api("/api/admin/stripe", cookie, { operation: "toggleCheckout", mode: "test", enabled: true });
  const checkout = await api("/api/billing/checkout", cookie, { kind: "package", itemId: "pkg_mini_5", returnUrl: appBase });
  const billing = await getJson("/api/admin/billing", cookie);
  const order = billing.stripeCheckoutOrders.find((item) => item.id === checkout.orderId);
  await sendWebhook({ id: "evt_phase12_paid", type: "checkout.session.completed", livemode: false, created, data: { object: { id: checkout.sessionId, customer: "cus_phase12", payment_intent: "pi_phase12", metadata: { orderId: order.id, catalogueRevisionId: order.catalogueRevisionId, stripeMode: "test", userId: "usr_demo", workspaceId: "ws_demo", purchaseKind: "package", itemId: "pkg_mini_5" } } } });

  step("Refunding the payment and verifying credits are actually removed");
  const beforeRefund = await getJson("/api/app", cookie);
  assert(beforeRefund.billing.balance.available >= 5000, `Expected the purchased 5,000 credits before refund, received ${beforeRefund.billing.balance.available}.`);
  await sendWebhook({ id: "evt_phase12_refund", type: "charge.refunded", livemode: false, created: created + 2, data: { object: { id: "ch_phase12", payment_intent: "pi_phase12", amount: 500, amount_refunded: 500 } } });
  const afterRefund = await getJson("/api/app", cookie);
  assert(beforeRefund.billing.balance.available - afterRefund.billing.balance.available === 5000, `Refund did not remove exactly 5,000 credits; balance changed from ${beforeRefund.billing.balance.available} to ${afterRefund.billing.balance.available}.`);

  step("Synchronizing Stripe balance transactions and checking finance metrics");
  const from = new Date((created - 3600) * 1000).toISOString();
  const to = new Date((created + 3600) * 1000).toISOString();
  const reconciled = await api("/api/admin/finance", cookie, { operation: "reconcile", mode: "test", from, to });
  assert(reconciled.transactions.length === 2, "Expected two synchronized balance transactions.");
  assert(reconciled.metrics.grossSalesUsd === 5 && reconciled.metrics.refundsUsd === 5, "Gross sale/refund accounting is incorrect.");
  assert(reconciled.metrics.stripeFeesUsd === 0.45 && reconciled.metrics.netCashUsd === -0.45, "Stripe fee/net cash accounting is incorrect.");
  assert(reconciled.dataSource === "stripe_balance_transactions", "Finance report did not prefer Stripe balance transactions.");

  step("Injecting controlled discrepancies and confirming reconciliation never edits the ledger");
  const db = JSON.parse(await fs.readFile(testDataFile, "utf8"));
  const originalOrder = db.billingCheckoutOrders.find((item) => item.id === order.id);
  originalOrder.status = "paid";
  const grant = db.billingLedger.find((item) => item.metadata?.checkoutOrderId === order.id && item.type === "purchase");
  db.billingLedger.push({ ...grant, id: "cred_phase12_duplicate", createdAt: new Date().toISOString() });
  db.billingCheckoutOrders.push({ ...originalOrder, id: "order_phase12_missing_credit", stripePaymentIntentId: "pi_phase12_missing", stripeCheckoutSessionId: "cs_phase12_missing", status: "paid", paidAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await fs.writeFile(testDataFile, JSON.stringify(db, null, 2));
  const ledgerCountBefore = db.billingLedger.length;
  const second = await api("/api/admin/finance", cookie, { operation: "reconcile", mode: "test", from, to: new Date(Date.now() + 3600_000).toISOString() });
  assert(second.alerts.some((item) => item.type === "duplicate_credit" && item.status === "open"), "Duplicate credit finding was not detected.");
  assert(second.alerts.some((item) => item.type === "payment_without_credits" && item.status === "open"), "Payment-without-credits finding was not detected.");
  const afterReconDb = JSON.parse(await fs.readFile(testDataFile, "utf8"));
  assert(afterReconDb.billingLedger.length === ledgerCountBefore, "Reconciliation modified the credit ledger.");

  step("Resolving a finding with audit note and closing an immutable period");
  const finding = second.alerts.find((item) => item.type === "duplicate_credit");
  await api("/api/admin/finance", cookie, { operation: "resolveAlert", alertId: finding.id, note: "Validated by Phase 12 smoke test." });
  const close = await api("/api/admin/finance", cookie, { operation: "closePeriod", mode: "test", periodType: "monthly", from, to });
  assert(close.close.hash?.length === 64, "Close report hash was not created.");
  const duplicateClose = await request("POST", "/api/admin/finance", cookie, { operation: "closePeriod", mode: "test", periodType: "monthly", from, to });
  assert(duplicateClose.status === 409, "An immutable close period was created twice.");

  step("Exporting auditable CSV records");
  const exportResponse = await fetch(`${appBase}/api/admin/finance/export?mode=test&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&dataset=transactions`, { headers: { Cookie: cookie } });
  const csv = await exportResponse.text();
  assert(exportResponse.ok && csv.includes("txn_phase12_charge") && csv.includes("payment_intent_id"), "Finance transaction CSV is incomplete.");

  process.stdout.write(JSON.stringify({ ok: true, refundBalanceCorrected: true, synchronizedTransactions: 2, grossSalesUsd: 5, refundsUsd: 5, stripeFeesUsd: 0.45, netCashUsd: -0.45, discrepancyTypes: ["duplicate_credit", "payment_without_credits"], reconciliationReadOnly: true, immutableClose: true, csvExport: true }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n${output}\n`);
  process.exitCode = 1;
} finally {
  app.kill("SIGTERM");
  await new Promise((resolve) => stripeServer.close(resolve));
  await fs.rm(testDataFile, { force: true });
}

async function login() { const res = await fetch(`${appBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@contentagent.tech", password: "demo1234" }) }); assert(res.ok, `Login failed: ${res.status}`); return res.headers.get("set-cookie")?.split(";")[0] || ""; }
async function api(path, cookie, body) { const response = await request("POST", path, cookie, body); if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${response.body.error || JSON.stringify(response.body)}`); return response.body; }
async function request(method, path, cookie, body) { const res = await fetch(`${appBase}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) }; }
async function getJson(path, cookie) { const res = await fetch(`${appBase}${path}`, { headers: { Cookie: cookie } }); const body = await res.json(); if (!res.ok) throw new Error(`${path} failed: ${body.error}`); return body; }
async function sendWebhook(event) { const payload = JSON.stringify(event); const timestamp = Math.floor(Date.now() / 1000); const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex"); const res = await fetch(`${appBase}/api/stripe/webhook/test`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body: payload }); assert(res.ok, `Webhook failed: ${res.status} ${await res.text()}`); }
async function waitFor(url) { for (let attempt = 0; attempt < 100; attempt += 1) { try { const res = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error(`Timed out waiting for ${url}`); }
function listen(server, port) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); }
function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function step(message) { process.stdout.write(`[stripe-phase12] ${message}\n`); }
