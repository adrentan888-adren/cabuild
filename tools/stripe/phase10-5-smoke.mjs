import crypto from "crypto";
import fs from "fs/promises";
import http from "http";
import { spawn } from "child_process";

const appPort = 3102;
const stripePort = 3210;
const appBase = `http://127.0.0.1:${appPort}`;
const webhookSecret = "whsec_phase10_5_test";
const testDataFile = ".next/phase10-5-test-data.json";
let productCount = 0;
let priceCount = 0;

await fs.rm(testDataFile, { force: true });
const stripeServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  const path = req.url || "";
  if (req.method === "GET" && path === "/v1/account") return json(res, 200, { id: "acct_phase10_5", country: "MY", default_currency: "usd", charges_enabled: true, payouts_enabled: true, business_profile: { name: "Content Agent Test" } });
  if (req.method === "POST" && path === "/v1/webhook_endpoints") return json(res, 200, { id: "we_phase10_5", secret: webhookSecret, url: body.get("url"), status: "enabled" });
  if (req.method === "GET" && path === "/v1/webhook_endpoints/we_phase10_5") return json(res, 200, { id: "we_phase10_5", url: `${appBase}/api/stripe/webhook/test`, status: "enabled" });
  if (req.method === "POST" && path === "/v1/products") return json(res, 200, { id: `prod_${++productCount}` });
  if (req.method === "POST" && path.startsWith("/v1/products/")) return json(res, 200, { id: path.split("/").pop(), name: body.get("name") });
  if (req.method === "POST" && path === "/v1/prices") return json(res, 200, { id: `price_${++priceCount}` });
  if (req.method === "POST" && path.startsWith("/v1/prices/")) return json(res, 200, { id: path.split("/").pop(), active: false });
  if (req.method === "POST" && path === "/v1/customers") return json(res, 200, { id: "cus_phase10_5" });
  if (req.method === "POST" && path === "/v1/checkout/sessions") return json(res, 200, { id: "cs_phase10_5", url: "https://checkout.stripe.test/cs_phase10_5" });
  if (req.method === "POST" && path === "/v1/billing_portal/sessions") return json(res, 200, { id: "bps_phase10_5", url: "https://billing.stripe.test/bps_phase10_5" });
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
    STRIPE_WEBHOOK_BASE_URL: appBase,
    STRIPE_LIVE_SETUP_ENABLED: "false",
    APP_SECRET: "phase10-5-test-secret"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let appOutput = "";
app.stdout.on("data", (chunk) => { appOutput += chunk.toString(); });
app.stderr.on("data", (chunk) => { appOutput += chunk.toString(); });

try {
  step("Waiting for Content Agent test server");
  await waitFor(`${appBase}/api/healthz`);
  step("Signing in with isolated seed account");
  const login = await fetch(`${appBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@contentagent.tech", password: "demo1234" }), signal: AbortSignal.timeout(5000) });
  assert(login.ok, `Login failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  assert(cookie, "Login did not return a session cookie.");

  step("Connecting test Stripe account and provisioning webhook");
  const connected = await api("/api/admin/stripe", cookie, {
    operation: "connect",
    mode: "test",
    secretKey: "sk_test_phase10_5",
    publishableKey: "pk_test_phase10_5"
  });
  assert(connected.connections?.find((item) => item.mode === "test")?.status === "connected", "Test Stripe account was not connected.");

  step("Creating and synchronizing eight Stripe catalogue offers");
  const synced = await api("/api/admin/stripe", cookie, { operation: "syncCatalogue", mode: "test", subscriptionPolicy: "new_customers_only" });
  assert(synced.ok, "Catalogue sync did not complete successfully.");
  assert(synced.catalogueMappings?.filter((item) => item.mode === "test" && item.active).length === 8, "Expected eight active test catalogue mappings.");

  step("Enabling test Checkout and creating an immutable order");
  await api("/api/admin/stripe", cookie, { operation: "toggleCheckout", mode: "test", enabled: true });
  const checkout = await api("/api/billing/checkout", cookie, { kind: "package", itemId: "pkg_mini_5", returnUrl: appBase });
  assert(checkout.orderId && checkout.sessionId === "cs_phase10_5", "Checkout order/session was not created.");

  const before = await getJson("/api/admin/billing", cookie);
  const order = before.stripeCheckoutOrders.find((item) => item.id === checkout.orderId);
  assert(order?.creditsPromised === 5000, "Checkout did not snapshot the original 5,000 credits.");

  step("Editing the package after Checkout to verify snapshot isolation");
  await patchBilling(cookie, { operation: "updateCreditPackage", id: "pkg_mini_5", name: "Mini Top-up", priceUsd: 6, baseCredits: 6000, bonusPercent: 0, bonusCredits: 0, active: true, expiresAfterDays: "", maxPurchasesPerMonth: "" });

  const event = {
    id: "evt_phase10_5_checkout",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: {
      id: "cs_phase10_5",
      customer: "cus_phase10_5",
      payment_intent: "pi_phase10_5",
      metadata: { orderId: checkout.orderId, catalogueRevisionId: order.catalogueRevisionId, stripeMode: "test", userId: "usr_demo", workspaceId: "ws_demo", purchaseKind: "package", itemId: "pkg_mini_5" }
    } }
  };
  step("Delivering signed and duplicate Stripe webhooks");
  const firstWebhook = await sendWebhook(event);
  assert(firstWebhook.status === 200, `Signed webhook failed: ${firstWebhook.status}`);
  const duplicateWebhook = await sendWebhook(event);
  assert(duplicateWebhook.status === 200 && duplicateWebhook.body.duplicate === true, "Duplicate webhook was not recognized.");

  step("Checking credit grant, signature rejection, and Customer Portal");
  const after = await getJson("/api/admin/billing", cookie);
  const grants = after.ledger.filter((entry) => entry.metadata?.checkoutOrderId === checkout.orderId && entry.type === "purchase");
  assert(grants.length === 1, `Expected one credit grant, found ${grants.length}.`);
  assert(grants[0].credits === 5000, `Expected snapshotted 5,000 credits, received ${grants[0].credits}.`);
  const latestOrder = after.stripeCheckoutOrders.find((item) => item.id === checkout.orderId);
  assert(latestOrder.status === "paid", "Checkout order did not move to paid.");

  const invalid = await fetch(`${appBase}/api/stripe/webhook/test`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=invalid" }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) });
  assert(invalid.status === 400, "Invalid webhook signature was not rejected.");

  const portal = await api("/api/billing/portal", cookie, { returnUrl: appBase });
  assert(portal.url === "https://billing.stripe.test/bps_phase10_5", "Customer Portal did not open through the mode-specific Stripe connection.");

  process.stdout.write(JSON.stringify({
    ok: true,
    connectedAccount: "acct_phase10_5",
    activeMappings: 8,
    checkoutOrder: checkout.orderId,
    creditsPromised: order.creditsPromised,
    creditsGranted: grants[0].credits,
    duplicateWebhookIgnored: true,
    invalidSignatureRejected: true,
    portalOpened: true
  }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n${appOutput}\n`);
  process.exitCode = 1;
} finally {
  app.kill("SIGTERM");
  await new Promise((resolve) => stripeServer.close(resolve));
  await fs.rm(testDataFile, { force: true });
}

async function api(path, cookie, body) {
  const res = await fetch(`${appBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 207) throw new Error(`${path} failed with ${res.status}: ${jsonBody.error || JSON.stringify(jsonBody)}`);
  return jsonBody;
}

async function patchBilling(cookie, body) {
  const res = await fetch(`${appBase}/api/admin/billing`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Billing PATCH failed with ${res.status}: ${jsonBody.error || JSON.stringify(jsonBody)}`);
  return jsonBody;
}

async function getJson(path, cookie) {
  const res = await fetch(`${appBase}${path}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} failed with ${res.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

async function sendWebhook(event) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  const res = await fetch(`${appBase}/api/stripe/webhook/test`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body: payload, signal: AbortSignal.timeout(5000) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
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

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function step(message) {
  process.stdout.write(`[stripe-phase10.5] ${message}\n`);
}
