import { NextResponse } from "next/server";
import { deleteApiKeyOverrides, getStripeModeKey, saveApiKeyOverride, stripeModeProvider } from "@/lib/apiKeyOverrides";
import { hasPermission, permissionCatalog } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { syncStripeCatalogue } from "@/lib/stripeCatalogue";
import { createStripeWebhookEndpoint, retrieveStripeWebhookEndpoint, validateStripeAccount } from "@/lib/stripeBilling";
import { ensureStripeLaunchDefaults, liveCatalogueComparison, liveLaunchPreflight, stripeOfferFingerprint } from "@/lib/stripeLaunch";
import { id, mutateDb, readDb } from "@/lib/store";
import type { BillingStripeLaunchReport, Database, PermissionKey, StripeLiveRolloutStage, StripeMode, User } from "@/lib/types";

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
  if (operation === "updateLiveReadiness") return updateLiveReadiness(body, mode);
  if (operation === "approveLiveReadiness") return approveLiveReadiness(body, mode);
  if (operation === "runLivePreflight") return runLivePreflight(mode);
  if (operation === "approveLiveCatalogue") return approveLiveCatalogue(body, mode);
  if (operation === "updateLiveRollout") return updateLiveRollout(body, mode);
  if (operation === "saveLiveLaunchReport") return saveLiveLaunchReport(body, mode);
  if (operation === "approveLiveLaunchReport") return approveLiveLaunchReport(body, mode);
  if (operation === "emergencyStopLive") return emergencyStopLive(body, mode);
  return NextResponse.json({ error: "Unsupported Stripe administration operation." }, { status: 400 });
}

async function connectStripe(req: Request, body: Record<string, unknown>, mode: StripeMode) {
  const auth = await requireStripeAdmin(mode === "test" ? "stripe.connectTest" : "stripe.connectLive");
  if ("error" in auth) return auth.error;
  if (mode === "live" && process.env.STRIPE_LIVE_SETUP_ENABLED !== "true") {
    return NextResponse.json({ error: "Live Stripe setup is locked until Phase 11. Set STRIPE_LIVE_SETUP_ENABLED=true only after the Phase 10.5 acceptance gate passes." }, { status: 403 });
  }
  if (mode === "live") {
    ensureStripeLaunchDefaults(auth.db);
    if (!auth.db.billingStripeLaunchControl.readinessApprovedAt) return NextResponse.json({ error: "Approve the Phase 11 live-readiness checklist before connecting live Stripe." }, { status: 400 });
    if (String(body.confirmation || "") !== "CONNECT LIVE STRIPE") return NextResponse.json({ error: "Type CONNECT LIVE STRIPE to confirm the live account connection." }, { status: 400 });
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
  if (mode === "live") {
    ensureStripeLaunchDefaults(auth.db);
    if (!auth.db.billingStripeLaunchControl.readinessApprovedAt) return NextResponse.json({ error: "Approve live readiness before synchronizing the live catalogue." }, { status: 400 });
    if (String(body.confirmation || "") !== "SYNC LIVE CATALOGUE") return NextResponse.json({ error: "Type SYNC LIVE CATALOGUE to confirm." }, { status: 400 });
  }
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
    ensureStripeLaunchDefaults(db);
    const profile = ensureProfile(db, mode);
    if (enabled) {
      if (profile.status !== "connected" || profile.webhookStatus !== "configured") return { error: "Connect and validate Stripe before enabling Checkout." };
      const offers = [...db.billingPlans.filter((item) => item.active).map((item) => ({ kind: "plan", id: item.id })), ...db.billingCreditPackages.filter((item) => item.active).map((item) => ({ kind: "package", id: item.id }))];
      const missing = offers.filter((offer) => !db.billingStripeCatalogueMappings.some((mapping) => mapping.mode === mode && mapping.itemKind === offer.kind && mapping.itemId === offer.id && mapping.active && mapping.status === "synced"));
      if (missing.length) return { error: `Synchronize the complete Stripe ${mode} catalogue first. ${missing.length} active offer(s) are not ready.` };
      if (mode === "live") {
        const launch = db.billingStripeLaunchControl;
        const fingerprint = stripeOfferFingerprint(db);
        if (!launch.readinessApprovedAt) return { error: "Live readiness is not approved." };
        if (!launch.liveCatalogueApprovedAt || launch.liveCatalogueFingerprint !== fingerprint) return { error: "Approve the current live catalogue before enabling Checkout." };
        if (launch.rolloutStage === "disabled") return { error: "Choose a controlled live rollout stage before enabling Checkout." };
        const preflight = liveLaunchPreflight(db);
        if (!preflight.passed) return { error: `Live preflight failed: ${preflight.checks.filter((check) => !check.passed).map((check) => check.label).join(", ")}.` };
        db.billingStripeLaunchControl.checkoutKillSwitch = false;
        db.billingStripeLaunchControl.emergencyReason = undefined;
      }
    } else if (mode === "live") {
      db.billingStripeLaunchControl.checkoutKillSwitch = true;
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

async function updateLiveReadiness(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live readiness applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.approveLiveLaunch");
  if ("error" in auth) return auth.error;
  const submitted = Array.isArray(body.readiness) ? body.readiness as Record<string, unknown>[] : [];
  await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const now = new Date().toISOString();
    for (const item of db.billingStripeLaunchControl.readiness) {
      const next = submitted.find((entry) => String(entry.key || "") === item.key);
      if (!next) continue;
      const confirmed = Boolean(next.confirmed);
      item.confirmed = confirmed;
      item.note = String(next.note || "").trim() || undefined;
      item.confirmedAt = confirmed ? now : undefined;
      item.confirmedBy = confirmed ? auth.user.id : undefined;
    }
    db.billingStripeLaunchControl.readinessApprovedAt = undefined;
    db.billingStripeLaunchControl.readinessApprovedBy = undefined;
    db.billingStripeLaunchControl.checkoutKillSwitch = true;
    const live = ensureProfile(db, "live");
    live.checkoutEnabled = false;
    db.billingSettings.stripeCheckoutEnabled ||= {};
    db.billingSettings.stripeCheckoutEnabled.live = false;
    db.billingStripeLaunchControl.updatedAt = now;
    db.billingStripeLaunchControl.updatedBy = auth.user.id;
    auditStripe(db, auth.user, "Updated Stripe live-readiness checklist.", { operation: "updateLiveReadiness", confirmed: db.billingStripeLaunchControl.readiness.filter((item) => item.confirmed).length });
  });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: "Live-readiness checklist saved. Owner approval is required again after any edit.", ...stripeAdminPayload(db, auth.user) });
}

async function approveLiveReadiness(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live readiness applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.approveLiveLaunch");
  if ("error" in auth) return auth.error;
  if (String(body.confirmation || "") !== "APPROVE LIVE READINESS") return NextResponse.json({ error: "Type APPROVE LIVE READINESS to confirm." }, { status: 400 });
  const result = await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const missing = db.billingStripeLaunchControl.readiness.filter((item) => !item.confirmed);
    if (missing.length) return { error: `Complete all readiness items first: ${missing.map((item) => item.label).join(", ")}.` };
    const now = new Date().toISOString();
    db.billingStripeLaunchControl.readinessApprovedAt = now;
    db.billingStripeLaunchControl.readinessApprovedBy = auth.user.id;
    db.billingStripeLaunchControl.updatedAt = now;
    db.billingStripeLaunchControl.updatedBy = auth.user.id;
    auditStripe(db, auth.user, "Approved Stripe live readiness.", { operation: "approveLiveReadiness" });
    return { ok: true };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: "Live readiness approved. The live account may now be connected.", ...stripeAdminPayload(db, auth.user) });
}

async function runLivePreflight(mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live preflight applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.view");
  if ("error" in auth) return auth.error;
  const result = await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const preflight = liveLaunchPreflight(db);
    db.billingStripeLaunchControl.lastPreflightAt = new Date().toISOString();
    db.billingStripeLaunchControl.lastPreflightPassed = preflight.passed;
    db.billingStripeLaunchControl.lastPreflightChecks = preflight.checks;
    auditStripe(db, auth.user, `Stripe live preflight ${preflight.passed ? "passed" : "failed"}.`, { operation: "runLivePreflight", checks: preflight.checks });
    return preflight;
  });
  const db = await readDb();
  return NextResponse.json({ ok: result.passed, preflight: result, message: result.passed ? "Live preflight passed." : "Live preflight has unresolved checks.", ...stripeAdminPayload(db, auth.user) }, { status: result.passed ? 200 : 207 });
}

async function approveLiveCatalogue(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live catalogue approval applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.approveLiveLaunch");
  if ("error" in auth) return auth.error;
  if (String(body.confirmation || "") !== "APPROVE LIVE CATALOGUE") return NextResponse.json({ error: "Type APPROVE LIVE CATALOGUE to confirm." }, { status: 400 });
  const result = await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const comparison = liveCatalogueComparison(db);
    if (!comparison.length || comparison.some((item) => !item.matches)) return { error: "Synchronize the complete live catalogue and resolve every mismatch before approval." };
    const now = new Date().toISOString();
    db.billingStripeLaunchControl.liveCatalogueFingerprint = stripeOfferFingerprint(db);
    db.billingStripeLaunchControl.liveCatalogueApprovedAt = now;
    db.billingStripeLaunchControl.liveCatalogueApprovedBy = auth.user.id;
    db.billingStripeLaunchControl.updatedAt = now;
    db.billingStripeLaunchControl.updatedBy = auth.user.id;
    auditStripe(db, auth.user, "Approved Stripe live catalogue.", { operation: "approveLiveCatalogue", fingerprint: db.billingStripeLaunchControl.liveCatalogueFingerprint });
    return { ok: true };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: "Current live catalogue approved.", ...stripeAdminPayload(db, auth.user) });
}

async function updateLiveRollout(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live rollout applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.manageLiveRollout");
  if ("error" in auth) return auth.error;
  const stage = String(body.stage || "") as StripeLiveRolloutStage;
  if (!(["disabled", "owner_only", "internal", "allowlist", "all_verified"] as string[]).includes(stage)) return NextResponse.json({ error: "Invalid live rollout stage." }, { status: 400 });
  const allowlistedUserIds = Array.isArray(body.allowlistedUserIds) ? body.allowlistedUserIds.map(String).filter(Boolean) : [];
  const result = await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const launch = db.billingStripeLaunchControl;
    if (stage !== "disabled") {
      const live = db.billingStripeConnections.find((item) => item.mode === "live");
      if (!launch.readinessApprovedAt || !launch.liveCatalogueApprovedAt || live?.status !== "connected" || live.webhookStatus !== "configured") return { error: "Complete readiness, live connection, webhook, catalogue sync, and catalogue approval first." };
      if (stage === "allowlist" && allowlistedUserIds.length === 0) return { error: "Select at least one user for the allowlist rollout." };
      if (["internal", "allowlist", "all_verified"].includes(stage) && !db.billingStripeLaunchReports.some((report) => report.status === "approved")) return { error: "Approve the owner live smoke-test report before expanding rollout." };
    }
    const now = new Date().toISOString();
    launch.rolloutStage = stage;
    launch.allowlistedUserIds = allowlistedUserIds;
    launch.updatedAt = now;
    launch.updatedBy = auth.user.id;
    if (stage === "disabled") {
      launch.checkoutKillSwitch = true;
      const live = ensureProfile(db, "live");
      live.checkoutEnabled = false;
      db.billingSettings.stripeCheckoutEnabled ||= {};
      db.billingSettings.stripeCheckoutEnabled.live = false;
    }
    auditStripe(db, auth.user, `Changed Stripe live rollout to ${stage}.`, { operation: "updateLiveRollout", stage, allowlistedUserIds });
    return { ok: true };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: `Live rollout changed to ${stage}.`, ...stripeAdminPayload(db, auth.user) });
}

async function saveLiveLaunchReport(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live report applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.manageLiveRollout");
  if ("error" in auth) return auth.error;
  const checksInput = body.checks && typeof body.checks === "object" ? body.checks as Record<string, unknown> : {};
  const result = await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const reportId = String(body.reportId || "");
    const existing = db.billingStripeLaunchReports.find((report) => report.id === reportId);
    const report: BillingStripeLaunchReport = {
      id: existing?.id || id("slr"),
      status: "draft",
      topUpOrderId: String(body.topUpOrderId || "").trim() || undefined,
      subscriptionOrderId: String(body.subscriptionOrderId || "").trim() || undefined,
      stripePaymentIntentId: String(body.stripePaymentIntentId || "").trim() || undefined,
      stripeSubscriptionId: String(body.stripeSubscriptionId || "").trim() || undefined,
      ledgerEntryIds: Array.isArray(body.ledgerEntryIds) ? body.ledgerEntryIds.map(String).filter(Boolean) : String(body.ledgerEntryIds || "").split(/[\s,]+/).filter(Boolean),
      checks: {
        topUpCreditsCorrect: Boolean(checksInput.topUpCreditsCorrect),
        subscriptionCreditsCorrect: Boolean(checksInput.subscriptionCreditsCorrect),
        receiptConfirmed: Boolean(checksInput.receiptConfirmed),
        portalConfirmed: Boolean(checksInput.portalConfirmed),
        cancellationConfirmed: Boolean(checksInput.cancellationConfirmed),
        refundConfirmed: Boolean(checksInput.refundConfirmed),
        duplicateWebhookConfirmed: Boolean(checksInput.duplicateWebhookConfirmed)
      },
      notes: String(body.notes || "").trim() || undefined,
      createdAt: existing?.createdAt || new Date().toISOString(),
      createdBy: existing?.createdBy || auth.user.id
    };
    if (existing) Object.assign(existing, report);
    else db.billingStripeLaunchReports.unshift(report);
    auditStripe(db, auth.user, "Saved Stripe live smoke-test report.", { operation: "saveLiveLaunchReport", reportId: report.id });
    return report;
  });
  const db = await readDb();
  return NextResponse.json({ ok: true, reportId: result.id, message: "Live smoke-test report saved as draft.", ...stripeAdminPayload(db, auth.user) });
}

async function approveLiveLaunchReport(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Live report applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.approveLiveLaunch");
  if ("error" in auth) return auth.error;
  if (String(body.confirmation || "") !== "APPROVE LIVE SMOKE TEST") return NextResponse.json({ error: "Type APPROVE LIVE SMOKE TEST to confirm." }, { status: 400 });
  const result = await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const report = db.billingStripeLaunchReports.find((item) => item.id === String(body.reportId || ""));
    if (!report) return { error: "Live smoke-test report not found." };
    if (Object.values(report.checks).some((value) => !value)) return { error: "Every smoke-test check must pass before approval." };
    if (!report.topUpOrderId || !report.subscriptionOrderId || report.ledgerEntryIds.length === 0) return { error: "Record the live top-up order, subscription order, and ledger IDs before approval." };
    const topUpOrder = db.billingCheckoutOrders.find((order) => order.id === report.topUpOrderId && order.mode === "live" && order.itemKind === "package" && order.status === "paid");
    const subscriptionOrder = db.billingCheckoutOrders.find((order) => order.id === report.subscriptionOrderId && order.mode === "live" && order.itemKind === "plan" && order.status === "paid");
    if (!topUpOrder || !subscriptionOrder) return { error: "The report must reference paid live top-up and subscription orders." };
    const reportLedger = db.billingLedger.filter((entry) => report.ledgerEntryIds.includes(entry.id) && entry.provider === "stripe" && String(entry.metadata?.stripeMode || "test") === "live");
    const requiredLedgerTypes = ["purchase", "subscription_grant", "refund"];
    if (requiredLedgerTypes.some((type) => !reportLedger.some((entry) => entry.type === type))) return { error: "The report ledger IDs must include the live top-up grant, subscription grant, and refund reversal." };
    report.status = "approved";
    report.approvedAt = new Date().toISOString();
    report.approvedBy = auth.user.id;
    auditStripe(db, auth.user, "Approved Stripe live smoke-test report.", { operation: "approveLiveLaunchReport", reportId: report.id });
    return { ok: true };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: "Live smoke-test report approved. Rollout may expand beyond owner accounts.", ...stripeAdminPayload(db, auth.user) });
}

async function emergencyStopLive(body: Record<string, unknown>, mode: StripeMode) {
  if (mode !== "live") return NextResponse.json({ error: "Emergency stop applies only to live mode." }, { status: 400 });
  const auth = await requireStripeAdmin("stripe.emergencyStop");
  if ("error" in auth) return auth.error;
  if (String(body.confirmation || "") !== "STOP LIVE CHECKOUT") return NextResponse.json({ error: "Type STOP LIVE CHECKOUT to confirm." }, { status: 400 });
  const reason = String(body.reason || "").trim();
  if (!reason) return NextResponse.json({ error: "Emergency-stop reason is required." }, { status: 400 });
  await mutateDb((db) => {
    ensureStripeLaunchDefaults(db);
    const now = new Date().toISOString();
    const launch = db.billingStripeLaunchControl;
    launch.checkoutKillSwitch = true;
    launch.emergencyStoppedAt = now;
    launch.emergencyStoppedBy = auth.user.id;
    launch.emergencyReason = reason;
    launch.updatedAt = now;
    launch.updatedBy = auth.user.id;
    const live = ensureProfile(db, "live");
    live.checkoutEnabled = false;
    live.updatedAt = now;
    live.updatedBy = auth.user.id;
    db.billingSettings.stripeCheckoutEnabled ||= {};
    db.billingSettings.stripeCheckoutEnabled.live = false;
    auditStripe(db, auth.user, "Emergency-stopped new Stripe live Checkout sessions.", { operation: "emergencyStopLive", reason, webhookPreserved: true });
  });
  const db = await readDb();
  return NextResponse.json({ ok: true, message: "New live Checkout sessions are blocked. Webhook ingestion remains active.", ...stripeAdminPayload(db, auth.user) });
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
  ensureStripeLaunchDefaults(db);
  const canViewEvents = hasPermission(db, user, "stripe.viewEvents");
  return {
    connections: db.billingStripeConnections,
    catalogueMappings: db.billingStripeCatalogueMappings.slice().sort((a, b) => Number(b.active) - Number(a.active) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    catalogueRevisions: db.billingStripeCatalogueRevisions.slice().sort((a, b) => new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime()).slice(0, 100),
    checkoutOrders: canViewEvents ? db.billingCheckoutOrders.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100) : [],
    subscriptionMigrations: db.billingStripeSubscriptionMigrations.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100),
    liveLaunchControl: db.billingStripeLaunchControl,
    liveLaunchReports: db.billingStripeLaunchReports.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20),
    liveCatalogueComparison: liveCatalogueComparison(db),
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
