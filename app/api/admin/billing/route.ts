import { NextResponse } from "next/server";
import { adminAdjustmentEntry, calculateCreditBalance, quoteBillingAction, recalculatePackageCredits, recalculatePlanCredits } from "@/lib/billing";
import { hasPermission } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { mutateDb, readDb } from "@/lib/store";
import type { BillingCreditPackage, BillingPlan, BillingRateCard, Database } from "@/lib/types";

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
      db.activity.push({ id: `act_${Date.now().toString(16)}`, workspaceId: workspace.id, message: `Admin adjusted credits by ${credits} for ${targetUser?.email || workspace.name}.`, createdAt: new Date().toISOString() });
      return { ok: true };
    }

    if (operation === "updateRateCard") {
      const id = String(body.id || "");
      const card = db.billingRateCards.find((item) => item.id === id);
      if (!card) return { error: "Rate card not found.", status: 404 as const };
      updateRateCard(card, body);
      return { ok: true };
    }

    if (operation === "updatePlan") {
      const id = String(body.id || "");
      const plan = db.billingPlans.find((item) => item.id === id);
      if (!plan) return { error: "Plan not found.", status: 404 as const };
      updatePlan(plan, body);
      Object.assign(plan, recalculatePlanCredits(plan));
      return { ok: true };
    }

    if (operation === "updateCreditPackage") {
      const id = String(body.id || "");
      const pkg = db.billingCreditPackages.find((item) => item.id === id);
      if (!pkg) return { error: "Credit package not found.", status: 404 as const };
      updatePackage(pkg, body);
      Object.assign(pkg, recalculatePackageCredits(pkg));
      return { ok: true };
    }

    if (operation === "updateSettings") {
      db.billingSettings = {
        ...db.billingSettings,
        defaultMarkupMultiplier: positiveNumber(body.defaultMarkupMultiplier, db.billingSettings.defaultMarkupMultiplier),
        lowCreditThreshold: positiveInteger(body.lowCreditThreshold, db.billingSettings.lowCreditThreshold),
        automationMinimumBalance: positiveInteger(body.automationMinimumBalance, db.billingSettings.automationMinimumBalance),
        automationDefaultRunCap: positiveInteger(body.automationDefaultRunCap, db.billingSettings.automationDefaultRunCap)
      };
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
  card.baseCostUsd = nonNegativeNumber(body.baseCostUsd, card.baseCostUsd);
  card.markupMultiplier = positiveNumber(body.markupMultiplier, card.markupMultiplier);
  card.minimumChargeCredits = nonNegativeInteger(body.minimumChargeCredits, card.minimumChargeCredits);
  if (typeof body.active === "boolean") card.active = body.active;
  card.source = "manual";
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
