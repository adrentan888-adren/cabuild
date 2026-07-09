import { NextResponse } from "next/server";
import { adminAdjustmentEntry, calculateCreditBalance, quoteBillingAction, recalculatePackageCredits, recalculatePlanCredits } from "@/lib/billing";
import { hasPermission } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";
import type { BillingCreditPackage, BillingPlan, BillingProviderMapping, BillingRateCard, Database, User } from "@/lib/types";

async function requireBillingAdmin(permission: "billing.view" | "billing.manage" = "billing.view") {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const db = await readDb();
  if (user.disabledAt || !hasPermission(db, user, "admin.access") || !hasPermission(db, user, permission)) {
    return { error: NextResponse.json({ error: "Billing permission required." }, { status: 403 }) };
  }
  return { user, db };
}

function billingPayload(db: Database) {
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
  return NextResponse.json(billingPayload(auth.db));
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
  return NextResponse.json({ ok: true, ...billingPayload(db) });
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
