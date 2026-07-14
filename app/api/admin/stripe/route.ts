import { NextResponse } from "next/server";
import { deleteApiKeyOverrides, getStripeModeKey, saveApiKeyOverride, stripeModeProvider } from "@/lib/apiKeyOverrides";
import { hasPermission, permissionCatalog } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { syncStripeCatalogue } from "@/lib/stripeCatalogue";
import { createStripeWebhookEndpoint, retrieveStripeWebhookEndpoint, validateStripeAccount } from "@/lib/stripeBilling";
import { id, mutateDb, readDb } from "@/lib/store";
import type { Database, PermissionKey, StripeMode, User } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireStripeAdmin("stripe.view");
  if ("error" in auth) return auth.error;
  return NextResponse.json(stripeAdminPayload(auth.db, auth.user));
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid Stripe administration request." }, { status: 400 });
  }
  const operation = String(body.operation || "");
  const mode = parseMode(body.mode);
  if (!mode) return NextResponse.json({ error: "Stripe mode must be test or live." }, { status: 400 });

  if (operation === "connect") return connectStripe(req, body, mode);
  if (operation === "validate") return validateConnection(mode);
  if (operation === "syncCatalogue") return synchronizeCatalogue(body, mode);
  if (operation === "toggleCheckout") return toggleCheckout(body, mode);
  if (operation === "disconnect") return disconnectStripe(body, mode);
  return NextResponse.json({ error: "Unsupported Stripe administration operation." }, { status: 400 });
}

async function connectStripe(req: Request, body: Record<string, unknown>, mode: StripeMode) {
  const auth = await requireStripeAdmin(mode === "test" ? "stripe.connectTest" : "stripe.connectLive");
  if ("error" in auth) return auth.error;
  if (mode === "live" && process.env.STRIPE_LIVE_SETUP_ENABLED !== "true") {
    return NextResponse.json({ error: "Live Stripe setup is locked until Phase 11. Set STRIPE_LIVE_SETUP_ENABLED=true only after the Phase 10.5 acceptance gate passes." }, { status: 403 });
  }
  const secretKey = String(body.secretKey || "").trim();
  const publishableKey = String(body.publishableKey || "").trim();
  if (!secretKey) return NextResponse.json({ error: "Stripe secret key is required." }, { status: 400 });
  if (publishableKey && !publishableKey.startsWith(mode === "test" ? "pk_test_" : "pk_live_")) {
    return NextResponse.json({ error: `Expected a Stripe ${mode} publishable key.` }, { status: 400 });
  }
  try {
    const account = await validateStripeAccount(secretKey, mode);
    const webhookBase = String(process.env.STRIPE_WEBHOOK_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
    const webhookUrl = `${webhookBase}/api/stripe/webhook/${mode}`;
    const existingProfile = auth.db.billingStripeConnections.find((item) => item.mode === mode);
    let webhook: { id: string; secret?: string; url: string };
    if (existingProfile?.accountId === account.id && existingProfile.webhookEndpointId && await getStripeModeKey(mode, "webhook")) {
      const existing = await retrieveStripeWebhookEndpoint(mode, existingProfile.webhookEndpointId).catch(() => null);
      webhook = existing && String(existing.status || "") === "enabled"
        ? { id: existingProfile.webhookEndpointId, url: String(existing.url || webhookUrl) }
        : await createStripeWebhookEndpoint(secretKey, mode, webhookUrl);
    } else {
      webhook = await createStripeWebhookEndpoint(secretKey, mode, webhookUrl);
    }
    await saveApiKeyOverride(stripeModeProvider(mode, "secret"), secretKey, auth.user.id);
    if (publishableKey) await saveApiKeyOverride(stripeModeProvider(mode, "publishable"), publishableKey, auth.user.id);
    if (webhook.secret) await saveApiKeyOverride(stripeModeProvider(mode, "webhook"), webhook.secret, auth.user.id);
    await mutateDb((db) => {
      const now = new Date().toISOString();
      const profile = ensureProfile(db, mode);
      Object.assign(profile, {
        status: "connected",
        accountId: account.id,
        accountName: account.displayName,
        country: account.country,
        defaultCurrency: account.defaultCurrency,
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        webhookEndpointId: webhook.id,
        webhookUrl: webhook.url,
        webhookStatus: "configured",
        checkoutEnabled: false,
        lastValidatedAt: now,
        error: undefined,
        updatedAt: now,
        updatedBy: auth.user.id
      });
      db.billingSettings.stripeCheckoutEnabled ||= {};
      db.billingSettings.stripeCheckoutEnabled[mode] = false;
      auditStripe(db, auth.user, `Connected Stripe ${mode} account.`, { operation: "connect", mode, accountId: account.id, webhookEndpointId: webhook.id });
    });
    const db = await readDb();
    return NextResponse.json({ ok: true, message: `Stripe ${mode} account connected. Checkout remains disabled until the catalogue is synchronized.`, ...stripeAdminPayload(db, auth.user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect Stripe." }, { status: 400 });
  }
}

async function validateConnection(mode: StripeMode) {
  const auth = await requireStripeAdmin("stripe.view");
  if ("error" in auth) return auth.error;
  try {
    const secretKey = await getStripeModeKey(mode, "secret");
    if (!secretKey) throw new Error(`Stripe ${mode} is not connected.`);
    const account = await validateStripeAccount(secretKey, mode);
    const profile = auth.db.billingStripeConnections.find((item) => item.mode === mode);
    const webhook = profile?.webhookEndpointId ? await retrieveStripeWebhookEndpoint(mode, profile.webhookEndpointId) : null;
    await mutateDb((db) => {
      const now = new Date().toISOString();
      Object.assign(ensureProfile(db, mode), {
        status: "connected",
        accountId: account.id,
        accountName: account.displayName,
        country: account.country,
        defaultCurrency: account.defaultCurrency,
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        webhookStatus: webhook && String(webhook.status || "") === "enabled" ? "configured" : "error",
        lastValidatedAt: now,
        error: undefined,
        updatedAt: now,
        updatedBy: auth.user.id
      });
      auditStripe(db, auth.user, `Validated Stripe ${mode} connection.`, { operation: "validate", mode, accountId: account.id, webhookStatus: String(webhook?.status || "missing") });
    });
    const db = await readDb();
    return NextResponse.json({ ok: true, message: `Stripe ${mode} connection is valid.`, ...stripeAdminPayload(db, auth.user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe validation failed.";
    await mutateDb((db) => {
      const profile = ensureProfile(db, mode);
      profile.status = "error";
      profile.error = message;
      profile.updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function synchronizeCatalogue(body: Record<string, unknown>, mode: StripeMode) {
  const auth = await requireStripeAdmin(mode === "test" ? "stripe.manageTestCatalogue" : "stripe.manageLiveCatalogue");
  if ("error" in auth) return auth.error;
  if (mode === "live" && process.env.STRIPE_LIVE_SETUP_ENABLED !== "true") return NextResponse.json({ error: "Live Stripe catalogue management is locked until Phase 11." }, { status: 403 });
  const policy = String(body.subscriptionPolicy || "new_customers_only");
  if (policy !== "new_customers_only") {
    return NextResponse.json({ error: "Phase 10.5 supports the safe new-customers-only policy. Existing subscription migration remains blocked until it is tested with the connected Stripe account." }, { status: 400 });
  }
  const result = await syncStripeCatalogue({ mode, actorId: auth.user.id, reason: String(body.reason || "").trim() || undefined, subscriptionPolicy: "new_customers_only" });
  await mutateDb((db) => auditStripe(db, auth.user, `Synchronized Stripe ${mode} catalogue.`, { operation: "syncCatalogue", mode, succeeded: result.results.filter((item) => item.status !== "failed").length, failed: result.results.filter((item) => item.status === "failed").length }));
  const db = await readDb();
  return NextResponse.json({ ...result, ...stripeAdminPayload(db, auth.user) }, { status: result.ok ? 200 : 207 });
}

async function toggleCheckout(body: Record<string, unknown>, mode: StripeMode) {
  const auth = await requireStripeAdmin(mode === "test" ? "stripe.manageTestCatalogue" : "stripe.manageLiveCatalogue");
  if ("error" in auth) return auth.error;
  const enabled = Boolean(body.enabled);
  if (mode === "live" && process.env.STRIPE_LIVE_SETUP_ENABLED !== "true") return NextResponse.json({ error: "Live Checkout is locked until Phase 11." }, { status: 403 });
  if (mode === "live" && enabled && String(body.confirmation || "") !== "ENABLE LIVE CHECKOUT") {
    return NextResponse.json({ error: "Type ENABLE LIVE CHECKOUT to confirm." }, { status: 400 });
  }
  const result = await mutateDb((db) => {
    const profile = ensureProfile(db, mode);
    if (enabled) {
      if (profile.status !== "connected" || profile.webhookStatus !== "configured") return { error: "Connect and validate Stripe before enabling Checkout." };
      const offers = [...db.billingPlans.filter((item) => item.active).map((item) => ({ kind: "plan", id: item.id })), ...db.billingCreditPackages.filter((item) => item.active).map((item) => ({ kind: "package", id: item.id }))];
      const missing = offers.filter((offer) => !db.billingStripeCatalogueMappings.some((mapping) => mapping.mode === mode && mapping.itemKind === offer.kind && mapping.itemId === offer.id && mapping.active && mapping.status === "synced"));
      if (missing.length) return { error: `Synchronize the complete Stripe ${mode} catalogue first. ${missing.length} active offer(s) are not ready.` };
    }
    profile.checkoutEnabled = enabled;
    profile.updatedAt = new Date().toISOString();
    profile.updatedBy = auth.user.id;
    db.billingSettings.stripeCheckoutEnabled ||= {};
    db.billingSettings.stripeCheckoutEnabled[mode] = enabled;
    auditStripe(db, auth.user, `${enabled ? "Enabled" : "Disabled"} Stripe ${mode} Checkout.`, { operation: "toggleCheckout", mode, enabled });
    return { ok: true };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: `Stripe ${mode} Checkout ${enabled ? "enabled" : "disabled"}.`, ...stripeAdminPayload(db, auth.user) });
}

async function disconnectStripe(body: Record<string, unknown>, mode: StripeMode) {
  const auth = await requireStripeAdmin("stripe.disconnect");
  if ("error" in auth) return auth.error;
  const required = mode === "live" ? "DISCONNECT LIVE STRIPE" : "DISCONNECT TEST STRIPE";
  if (String(body.confirmation || "") !== required) return NextResponse.json({ error: `Type ${required} to confirm.` }, { status: 400 });
  await mutateDb((db) => {
    const profile = ensureProfile(db, mode);
    Object.assign(profile, { status: "disconnected", checkoutEnabled: false, webhookStatus: "missing", error: undefined, updatedAt: new Date().toISOString(), updatedBy: auth.user.id });
    db.billingSettings.stripeCheckoutEnabled ||= {};
    db.billingSettings.stripeCheckoutEnabled[mode] = false;
    auditStripe(db, auth.user, `Disconnected Stripe ${mode} account while retaining financial history.`, { operation: "disconnect", mode, accountId: profile.accountId });
  });
  await deleteApiKeyOverrides([
    stripeModeProvider(mode, "publishable"),
    stripeModeProvider(mode, "secret"),
    stripeModeProvider(mode, "webhook"),
    stripeModeProvider(mode, "portal")
  ]);
  const db = await readDb();
  return NextResponse.json({ ok: true, message: `Stripe ${mode} disconnected. Catalogue and financial history were retained.`, ...stripeAdminPayload(db, auth.user) });
}

async function requireStripeAdmin(permission: PermissionKey) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const db = await readDb();
  if (user.disabledAt || !hasPermission(db, user, "admin.access") || !hasPermission(db, user, permission)) {
    return { error: NextResponse.json({ error: "Stripe permission required." }, { status: 403 }) };
  }
  return { user, db };
}

function stripeAdminPayload(db: Database, user: User) {
  const canViewEvents = hasPermission(db, user, "stripe.viewEvents");
  return {
    connections: db.billingStripeConnections,
    catalogueMappings: db.billingStripeCatalogueMappings.slice().sort((a, b) => Number(b.active) - Number(a.active) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    catalogueRevisions: db.billingStripeCatalogueRevisions.slice().sort((a, b) => new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime()).slice(0, 100),
    checkoutOrders: canViewEvents ? db.billingCheckoutOrders.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100) : [],
    subscriptionMigrations: db.billingStripeSubscriptionMigrations.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100),
    permissions: user.role === "owner" || user.role === "super_admin" ? permissionCatalog.map((item) => item.key) : db.rolePermissions[user.role] || [],
    liveSetupLocked: process.env.STRIPE_LIVE_SETUP_ENABLED !== "true"
  };
}

function ensureProfile(db: Database, mode: StripeMode) {
  let profile = db.billingStripeConnections.find((item) => item.mode === mode);
  if (!profile) {
    profile = { mode, status: "disconnected", checkoutEnabled: false, webhookStatus: "missing" };
    db.billingStripeConnections.push(profile);
  }
  return profile;
}

function auditStripe(db: Database, actor: User, message: string, details: Record<string, unknown>) {
  const now = new Date().toISOString();
  db.activity.push({ id: id("act"), workspaceId: actor.workspaceId, message, createdAt: now });
  db.debugLogs.push({ id: id("log"), workspaceId: actor.workspaceId, action: "adminStripe", label: message, status: "success", provider: "system", details, createdAt: now });
}

function parseMode(value: unknown): StripeMode | null {
  return value === "test" || value === "live" ? value : null;
}
