import { NextResponse } from "next/server";
import { adminAdjustmentEntry, calculateCreditBalance, quoteBillingAction, recalculatePackageCredits, recalculatePlanCredits } from "@/lib/billing";
import { hasPermission } from "@/lib/permissions";
import { collectPricingSyncProposals } from "@/lib/pricingSync";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";
import type { BillingCreditPackage, BillingPlan, BillingPricingAlert, BillingProvider, BillingProviderMapping, BillingRateCard, Database, User } from "@/lib/types";

async function requireBillingAdmin(permission: "billing.view" | "billing.manage" = "billing.view") {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const db = await readDb();
  if (user.disabledAt || !hasPermission(db, user, "admin.access") || !hasPermission(db, user, permission)) {
    return { error: NextResponse.json({ error: "Billing permission required." }, { status: 403 }) };
  }
  return { user, db };
}

function billingPayload(db: Database, actor?: User) {
  const workspaceBalances = db.workspaces.map((workspace) => {
    const balance = calculateCreditBalance(db, workspace.id);
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      plan: workspace.plan,
      credits: workspace.credits,
      ...balance
    };
  });
  return {
    settings: db.billingSettings,
    workspaceBalances,
    users: db.users.map((user) => {
      const workspace = db.workspaces.find((item) => item.id === user.workspaceId);
      const balance = calculateCreditBalance(db, user.workspaceId);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: user.workspaceId,
        workspaceName: workspace?.name || "Missing workspace",
        credits: balance.available
      };
    }),
    plans: db.billingPlans,
    creditPackages: db.billingCreditPackages,
    rateCards: db.billingRateCards,
    providerMappings: db.billingProviderMappings,
    pricingSyncRuns: (db.billingPricingSyncRuns || []).slice().sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 50),
    pricingAlerts: (db.billingPricingAlerts || []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250),
    stripeSubscriptions: (db.billingSubscriptions || []).slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 100),
    stripeEvents: actor && hasPermission(db, actor, "stripe.viewEvents") ? (db.billingStripeEvents || []).slice().sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime()).slice(0, 100) : [],
    stripeConnections: db.billingStripeConnections,
    stripeCatalogueMappings: db.billingStripeCatalogueMappings.slice().sort((a, b) => Number(b.active) - Number(a.active) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    stripeCatalogueRevisions: db.billingStripeCatalogueRevisions.slice().sort((a, b) => new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime()).slice(0, 100),
    stripeCheckoutOrders: actor && hasPermission(db, actor, "stripe.viewEvents") ? db.billingCheckoutOrders.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100) : [],
    stripeSubscriptionMigrations: db.billingStripeSubscriptionMigrations.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100),
    stripePermissions: actor ? db.rolePermissions[actor.role] || [] : [],
    stripeLiveSetupLocked: process.env.STRIPE_LIVE_SETUP_ENABLED !== "true",
    ledger: db.billingLedger.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250)
  };
}

function auditBillingChange(db: Database, actor: User, message: string, details?: Record<string, unknown>) {
  db.activity.push({ id: id("act"), workspaceId: actor.workspaceId, message, createdAt: new Date().toISOString() });
  db.debugLogs ||= [];
  db.debugLogs.push({
    id: id("log"),
    workspaceId: actor.workspaceId,
    action: "adminBilling",
    label: message,
    status: "success",
    provider: "system",
    details,
    createdAt: new Date().toISOString()
  });
}

export async function GET() {
  const auth = await requireBillingAdmin("billing.view");
  if ("error" in auth) return auth.error;
  return NextResponse.json(billingPayload(auth.db, auth.user));
}

export async function POST(req: Request) {
  const auth = await requireBillingAdmin("billing.view");
  if ("error" in auth) return auth.error;
  const body = await req.json() as Record<string, unknown>;
  try {
    const quote = quoteBillingAction(auth.db, body);
    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not quote billing action." }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireBillingAdmin("billing.manage");
  if ("error" in auth) return auth.error;
  const body = await req.json() as Record<string, unknown>;
  const operation = String(body.operation || "");

  if (operation === "updateSettings" && body.stripeMode === "live") {
    if (process.env.STRIPE_LIVE_SETUP_ENABLED !== "true") return NextResponse.json({ error: "Live Stripe mode is locked until Phase 11." }, { status: 403 });
    const live = auth.db.billingStripeConnections.find((item) => item.mode === "live");
    if (!live?.checkoutEnabled || live.status !== "connected") return NextResponse.json({ error: "Connect, synchronize, and enable live Stripe Checkout before switching the frontend to live mode." }, { status: 400 });
  }

  if (operation === "syncProviderPricing") {
    const provider = String(body.provider || "") as BillingProvider;
    if (!["kie", "apify", "upload-post", "brevo", "stripe", "local", "custom"].includes(provider)) {
      return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
    }
    const startedAt = new Date().toISOString();
    let syncError = "";
    let scannedCount = 0;
    let proposals: Omit<BillingPricingAlert, "id" | "runId" | "createdAt" | "decidedAt" | "decidedBy" | "appliedAt">[] = [];
    try {
      const scan = await collectPricingSyncProposals(auth.db, provider);
      scannedCount = scan.scannedCount;
      proposals = scan.proposals;
    } catch (error) {
      syncError = error instanceof Error ? error.message : "Provider pricing sync failed.";
      scannedCount = (auth.db.billingRateCards || []).filter((card) => card.provider === provider).length;
    }
    await mutateDb((db) => {
      db.billingPricingSyncRuns ||= [];
      db.billingPricingAlerts ||= [];
      const runId = id("psync");
      const now = new Date().toISOString();
      const createdAlerts = proposals.filter((proposal) => !hasOpenPricingAlert(db, proposal.rateCardId));
      db.billingPricingSyncRuns.unshift({
        id: runId,
        provider,
        status: syncError ? "failed" : "completed",
        scannedCount,
        alertCount: createdAlerts.length,
        manualRequiredCount: createdAlerts.filter((alert) => alert.status === "manual_required").length,
        startedAt,
        completedAt: now,
        error: syncError || undefined,
        createdBy: auth.user.id
      });
      for (const proposal of createdAlerts) {
        db.billingPricingAlerts.unshift({ ...proposal, id: id("palert"), runId, createdAt: now });
      }
      auditBillingChange(db, auth.user, syncError ? `Admin pricing sync failed for ${provider}.` : `Admin ran pricing sync for ${provider}.`, { operation, provider, scannedCount, createdAlerts: createdAlerts.length, error: syncError || undefined });
      return { ok: true };
    });
    const db = await readDb();
    return NextResponse.json({ ok: true, ...billingPayload(db, auth.user) });
  }

  const result = await mutateDb((db) => {
    if (operation === "adjustCredits") {
      const userId = String(body.userId || "");
      const workspaceId = String(body.workspaceId || "");
      const targetUser = userId ? db.users.find((user) => user.id === userId) : undefined;
      const targetWorkspaceId = targetUser?.workspaceId || workspaceId;
      const workspace = db.workspaces.find((item) => item.id === targetWorkspaceId);
      if (!workspace) return { error: "Workspace/user is required.", status: 400 as const };
      const credits = Math.round(Number(body.credits || 0));
      if (!Number.isFinite(credits) || credits === 0) return { error: "Credit adjustment must be a non-zero number.", status: 400 as const };
      const description = String(body.description || "").trim() || (credits > 0 ? "Admin credit grant" : "Admin credit removal");
      const expiresAt = String(body.expiresAt || "").trim();
      db.billingLedger.push(adminAdjustmentEntry({
        workspaceId: workspace.id,
        userId: targetUser?.id,
        credits,
        description,
        actorUserId: auth.user.id,
        expiresAt: expiresAt || undefined
      }));
      workspace.credits = calculateCreditBalance(db, workspace.id).available;
      auditBillingChange(db, auth.user, `Admin adjusted credits by ${credits} for ${targetUser?.email || workspace.name}.`, { operation, targetUserId: targetUser?.id, workspaceId: workspace.id, credits, description });
      return { ok: true };
    }

    if (operation === "updateRateCard") {
      const id = String(body.id || "");
      const card = db.billingRateCards.find((item) => item.id === id);
      if (!card) return { error: "Rate card not found.", status: 404 as const };
      updateRateCard(card, body);
      auditBillingChange(db, auth.user, `Admin updated billing rate card: ${card.label}.`, { operation, rateCardId: card.id, provider: card.provider, modelOrActorId: card.modelOrActorId });
      return { ok: true };
    }

    if (operation === "approvePricingAlert") {
      const alert = findPricingAlert(db, body);
      if ("error" in alert) return alert;
      if (typeof alert.item.newBaseCostUsd !== "number") return { error: "This alert requires manual review and has no provider price to apply.", status: 400 as const };
      const card = db.billingRateCards.find((item) => item.id === alert.item.rateCardId);
      if (!card) return { error: "Rate card not found.", status: 404 as const };
      const now = new Date().toISOString();
      card.baseCostUsd = alert.item.newBaseCostUsd;
      if (alert.item.newUnit) card.unit = alert.item.newUnit;
      card.source = "provider_sync";
      card.lastSyncedAt = now;
      card.metadata = {
        ...(card.metadata || {}),
        providerSync: {
          alertId: alert.item.id,
          runId: alert.item.runId,
          previousBaseCostUsd: alert.item.oldBaseCostUsd,
          previousUnit: alert.item.oldUnit,
          source: alert.item.source,
          appliedAt: now,
          appliedBy: auth.user.id
        }
      };
      alert.item.status = "approved";
      alert.item.decidedAt = now;
      alert.item.decidedBy = auth.user.id;
      alert.item.appliedAt = now;
      auditBillingChange(db, auth.user, `Admin approved provider pricing change: ${card.label}.`, { operation, alertId: alert.item.id, rateCardId: card.id, newBaseCostUsd: card.baseCostUsd, unit: card.unit });
      return { ok: true };
    }

    if (operation === "rejectPricingAlert" || operation === "keepManualPricingAlert") {
      const alert = findPricingAlert(db, body);
      if ("error" in alert) return alert;
      const now = new Date().toISOString();
      alert.item.status = operation === "rejectPricingAlert" ? "rejected" : "kept_manual";
      alert.item.decidedAt = now;
      alert.item.decidedBy = auth.user.id;
      auditBillingChange(db, auth.user, operation === "rejectPricingAlert" ? `Admin rejected pricing alert: ${alert.item.label}.` : `Admin kept manual pricing for: ${alert.item.label}.`, { operation, alertId: alert.item.id, rateCardId: alert.item.rateCardId });
      return { ok: true };
    }

    if (operation === "updateProviderMapping") {
      const id = String(body.id || "");
      const mapping = db.billingProviderMappings.find((item) => item.id === id);
      if (!mapping) return { error: "Provider mapping not found.", status: 404 as const };
      updateProviderMapping(mapping, body);
      auditBillingChange(db, auth.user, `Admin updated provider mapping: ${mapping.label}.`, { operation, mappingId: mapping.id, uiKey: mapping.uiKey, providerModelOrActorId: mapping.providerModelOrActorId });
      return { ok: true };
    }

    if (operation === "updatePlan") {
      const id = String(body.id || "");
      const plan = db.billingPlans.find((item) => item.id === id);
      if (!plan) return { error: "Plan not found.", status: 404 as const };
      updatePlan(plan, body);
      Object.assign(plan, recalculatePlanCredits(plan));
      auditBillingChange(db, auth.user, `Admin updated billing plan: ${plan.name}.`, { operation, planId: plan.id, priceUsd: plan.priceUsd, totalCredits: plan.totalCredits });
      return { ok: true };
    }

    if (operation === "updateCreditPackage") {
      const id = String(body.id || "");
      const pkg = db.billingCreditPackages.find((item) => item.id === id);
      if (!pkg) return { error: "Credit package not found.", status: 404 as const };
      updatePackage(pkg, body);
      Object.assign(pkg, recalculatePackageCredits(pkg));
      auditBillingChange(db, auth.user, `Admin updated credit package: ${pkg.name}.`, { operation, packageId: pkg.id, priceUsd: pkg.priceUsd, totalCredits: pkg.totalCredits });
      return { ok: true };
    }

    if (operation === "updateSettings") {
      db.billingSettings = {
        ...db.billingSettings,
        defaultMarkupMultiplier: positiveNumber(body.defaultMarkupMultiplier, db.billingSettings.defaultMarkupMultiplier),
        lowCreditThreshold: positiveInteger(body.lowCreditThreshold, db.billingSettings.lowCreditThreshold),
        automationMinimumBalance: positiveInteger(body.automationMinimumBalance, db.billingSettings.automationMinimumBalance),
        automationDefaultRunCap: positiveInteger(body.automationDefaultRunCap, db.billingSettings.automationDefaultRunCap),
        automationDefaultMonthlyCap: positiveInteger(body.automationDefaultMonthlyCap, db.billingSettings.automationDefaultMonthlyCap),
        dailySpendLimitCredits: nonNegativeInteger(body.dailySpendLimitCredits, db.billingSettings.dailySpendLimitCredits || 0),
        monthlySpendLimitCredits: nonNegativeInteger(body.monthlySpendLimitCredits, db.billingSettings.monthlySpendLimitCredits || 0),
        maxConcurrentGenerations: positiveInteger(body.maxConcurrentGenerations, db.billingSettings.maxConcurrentGenerations || 1),
        failedGenerationRefundPolicy: parseRefundPolicy(body.failedGenerationRefundPolicy, db.billingSettings.failedGenerationRefundPolicy || "refund_if_provider_failed"),
        stripeMode: body.stripeMode === "live" ? "live" : "test"
      };
      auditBillingChange(db, auth.user, "Admin updated billing rules and settings.", { operation, settings: db.billingSettings });
      return { ok: true };
    }

    return { error: "Unsupported billing operation.", status: 400 as const };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const db = await readDb();
  return NextResponse.json({ ok: true, ...billingPayload(db, auth.user) });
}

function updateRateCard(card: BillingRateCard, body: Record<string, unknown>) {
  if (typeof body.label === "string") card.label = body.label.trim() || card.label;
  if (typeof body.provider === "string" && ["kie", "apify", "upload-post", "brevo", "stripe", "local", "custom"].includes(body.provider)) {
    card.provider = body.provider as BillingRateCard["provider"];
  }
  if (typeof body.actionType === "string" && ["video_generation", "image_generation", "text_generation", "scrape", "persona_crawl", "publish", "automation_run", "ai_assist"].includes(body.actionType)) {
    card.actionType = body.actionType as BillingRateCard["actionType"];
  }
  if (typeof body.modelOrActorId === "string") card.modelOrActorId = body.modelOrActorId.trim() || card.modelOrActorId;
  if (typeof body.unit === "string" && ["per_action", "per_second", "per_image", "per_1k_tokens", "per_1k_results", "per_post"].includes(body.unit)) {
    card.unit = body.unit as BillingRateCard["unit"];
  }
  card.baseCostUsd = nonNegativeNumber(body.baseCostUsd, card.baseCostUsd);
  card.markupMultiplier = positiveNumber(body.markupMultiplier, card.markupMultiplier);
  card.minimumChargeCredits = nonNegativeInteger(body.minimumChargeCredits, card.minimumChargeCredits);
  if (typeof body.active === "boolean") card.active = body.active;
  card.source = "manual";
  card.lastSyncedAt = undefined;
}

function hasOpenPricingAlert(db: Database, rateCardId: string) {
  return (db.billingPricingAlerts || []).some((alert) => alert.rateCardId === rateCardId && ["pending_review", "manual_required"].includes(alert.status));
}

function findPricingAlert(db: Database, body: Record<string, unknown>) {
  db.billingPricingAlerts ||= [];
  const alertId = String(body.alertId || "");
  const item = db.billingPricingAlerts.find((alert) => alert.id === alertId);
  if (!item) return { error: "Pricing alert not found.", status: 404 as const };
  if (!["pending_review", "manual_required"].includes(item.status)) return { error: "Pricing alert has already been decided.", status: 400 as const };
  return { item };
}

function updateProviderMapping(mapping: BillingProviderMapping, body: Record<string, unknown>) {
  if (typeof body.label === "string") mapping.label = body.label.trim() || mapping.label;
  if (typeof body.uiKey === "string") mapping.uiKey = body.uiKey.trim() || mapping.uiKey;
  if (typeof body.provider === "string" && ["kie", "apify", "upload-post", "brevo", "stripe", "local", "custom"].includes(body.provider)) {
    mapping.provider = body.provider as BillingProviderMapping["provider"];
  }
  if (typeof body.providerModelOrActorId === "string") mapping.providerModelOrActorId = body.providerModelOrActorId.trim() || mapping.providerModelOrActorId;
  if (typeof body.actionType === "string" && ["video_generation", "image_generation", "text_generation", "scrape", "persona_crawl", "publish", "automation_run", "ai_assist"].includes(body.actionType)) {
    mapping.actionType = body.actionType as BillingProviderMapping["actionType"];
  }
  if (typeof body.active === "boolean") mapping.active = body.active;
}

function updatePlan(plan: BillingPlan, body: Record<string, unknown>) {
  if (typeof body.name === "string") plan.name = body.name.trim() || plan.name;
  plan.priceUsd = nonNegativeNumber(body.priceUsd, plan.priceUsd);
  plan.baseCredits = nonNegativeInteger(body.baseCredits, plan.baseCredits);
  plan.bonusPercent = nonNegativeNumber(body.bonusPercent, plan.bonusPercent);
  plan.expiryDays = positiveInteger(body.expiryDays, plan.expiryDays);
  if (typeof body.stripePriceId === "string") plan.stripePriceId = body.stripePriceId.trim() || undefined;
  if (typeof body.active === "boolean") plan.active = body.active;
  if (typeof body.automationAllowed === "boolean") plan.automationAllowed = body.automationAllowed;
  plan.maxConcurrentGenerations = positiveInteger(body.maxConcurrentGenerations, plan.maxConcurrentGenerations || 1);
  plan.monthlyUsageLimitCredits = body.monthlyUsageLimitCredits === "" ? undefined : nonNegativeInteger(body.monthlyUsageLimitCredits, plan.monthlyUsageLimitCredits || 0) || undefined;
}

function updatePackage(pkg: BillingCreditPackage, body: Record<string, unknown>) {
  if (typeof body.name === "string") pkg.name = body.name.trim() || pkg.name;
  pkg.priceUsd = nonNegativeNumber(body.priceUsd, pkg.priceUsd);
  pkg.baseCredits = nonNegativeInteger(body.baseCredits, pkg.baseCredits);
  pkg.bonusPercent = nonNegativeNumber(body.bonusPercent, pkg.bonusPercent);
  pkg.bonusCredits = nonNegativeInteger(body.bonusCredits, pkg.bonusCredits);
  if (typeof body.stripePriceId === "string") pkg.stripePriceId = body.stripePriceId.trim() || undefined;
  if (typeof body.active === "boolean") pkg.active = body.active;
  pkg.expiresAfterDays = body.expiresAfterDays === "" ? undefined : positiveInteger(body.expiresAfterDays, pkg.expiresAfterDays || 0) || undefined;
  pkg.maxPurchasesPerMonth = body.maxPurchasesPerMonth === "" ? undefined : positiveInteger(body.maxPurchasesPerMonth, pkg.maxPurchasesPerMonth || 0) || undefined;
}

function nonNegativeNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const next = Math.round(Number(value));
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const next = Math.round(Number(value));
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function parseRefundPolicy(value: unknown, fallback: NonNullable<Database["billingSettings"]["failedGenerationRefundPolicy"]>) {
  return value === "release_only" || value === "manual_review" || value === "refund_if_provider_failed" ? value : fallback;
}
