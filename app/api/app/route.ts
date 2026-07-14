import { NextResponse } from "next/server";
import { calculateCreditBalance } from "@/lib/billing";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";
import { getConnectedUploadPostAccounts } from "@/lib/providers/uploadPost";
import type { Brief } from "@/lib/types";

function contentKindFromFormat(format: string) {
  const lower = format.toLowerCase();
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok") || lower.includes("youtube")) return "video";
  if (lower.includes("image") || lower.includes("carousel")) return "image";
  return "text";
}

function normalizedResearchBrief(brief: Brief) {
  if (!brief.sourceResultId) return brief;
  const sourceKind = brief.sourceMediaType === "image"
    ? "image"
    : brief.sourceMediaType === "video"
      ? "video"
      : (brief.sourcePlatform === "LinkedIn" || brief.sourcePlatform === "X" ? "text" : "");
  if (!sourceKind || contentKindFromFormat(brief.format) === sourceKind) return brief;
  const format = sourceKind === "image" ? "Image 1:1" : sourceKind === "text" ? "Text post" : brief.sourcePlatform === "YouTube" ? "Long-form video 16:9" : "Short video 9:16";
  return { ...brief, format, duration: sourceKind === "video" ? brief.duration : undefined };
}

function sumCredits(entries: { credits: number }[]) {
  return entries.reduce((sum, entry) => sum + Math.abs(Math.ceil(Number(entry.credits || 0))), 0);
}

function groupUsage(entries: ReturnType<typeof safeBillingEntry>[], key: "module" | "provider") {
  const map = new Map<string, { key: string; credits: number; entries: number }>();
  entries
    .filter((entry) => entry.type === "usage" && entry.status === "succeeded")
    .forEach((entry) => {
      const groupKey = entry[key] || "unknown";
      const current = map.get(groupKey) || { key: groupKey, credits: 0, entries: 0 };
      current.credits += Math.abs(Math.ceil(entry.credits || 0));
      current.entries += 1;
      map.set(groupKey, current);
    });
  return Array.from(map.values()).sort((a, b) => b.credits - a.credits);
}

function safeBillingEntry(entry: {
  id: string;
  type: string;
  module: string;
  provider: string;
  action: string;
  credits: number;
  usdCost: number;
  markup: number;
  status: string;
  description: string;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}) {
  const metadata = entry.metadata || {};
  const chargeUsd = typeof metadata.chargeUsd === "number" ? metadata.chargeUsd : Math.max(0, Math.abs(entry.credits || 0) / 1000);
  return {
    id: entry.id,
    type: entry.type,
    module: entry.module,
    provider: entry.provider,
    action: entry.action,
    credits: Math.round(entry.credits || 0),
    usdCost: entry.usdCost,
    chargeUsd,
    markup: entry.markup,
    status: entry.status,
    description: entry.description,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt
  };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const connectedSocialAccounts = await getConnectedUploadPostAccounts().catch(() => []);
  const workspace = db.workspaces.find((item) => item.id === user.workspaceId)!;
  const workspaceAssets = db.assets.filter((item) => item.workspaceId === workspace.id);
  const billingLedger = (db.billingLedger || [])
    .filter((item) => item.workspaceId === workspace.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(safeBillingEntry);
  const activeLedger = billingLedger.filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() >= Date.now());
  const billingBalance = calculateCreditBalance(db, workspace.id);
  const stripeMode = db.billingSettings.stripeMode === "live" ? "live" : "test";
  const stripeConnection = db.billingStripeConnections.find((item) => item.mode === stripeMode);
  const stripeCheckoutEnabled = Boolean(stripeConnection?.checkoutEnabled && db.billingSettings.stripeCheckoutEnabled?.[stripeMode]);
  const billingPlans = (db.billingPlans || []).filter((plan) => plan.active);
  const billingCreditPackages = (db.billingCreditPackages || []).filter((pkg) => pkg.active);
  const currentSubscription = (db.billingSubscriptions || [])
    .filter((item) => item.workspaceId === workspace.id)
    .filter((item) => (item.stripeMode || "test") === stripeMode)
    .filter((item) => ["active", "trialing", "past_due"].includes(item.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
  const currentPlan = billingPlans.find((plan) => plan.id === currentSubscription?.planId)
    || billingPlans.find((plan) => plan.name.toLowerCase() === String(workspace.plan || "").toLowerCase())
    || null;
  const usageEntries = billingLedger.filter((entry) => entry.type === "usage" && entry.status === "succeeded");
  const paymentHistory = billingLedger
    .filter((entry) => ["purchase", "subscription_grant", "refund"].includes(entry.type) || entry.provider === "stripe")
    .slice(0, 50);
  const scoped = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    workspace,
    brandKit: db.brandKits.find((item) => item.workspaceId === workspace.id),
    personaProfile: db.personaProfiles.find((item) => item.workspaceId === workspace.id),
    competitors: db.competitors.filter((item) => item.workspaceId === workspace.id),
    competitorResults: (db.competitorResults || []).filter((item) => item.workspaceId === workspace.id),
    researchScans: (db.researchScans || []).filter((item) => item.workspaceId === workspace.id).slice(-10).reverse(),
    socialAudits: (db.socialAudits || []).filter((item) => item.workspaceId === workspace.id).slice(-5).reverse(),
    connectedSocialAccounts,
    opportunities: db.opportunities.filter((item) => item.workspaceId === workspace.id),
    briefs: db.briefs.filter((item) => item.workspaceId === workspace.id).map(normalizedResearchBrief),
    assets: workspaceAssets,
    publishQueue: db.publishQueue
      .filter((item) => item.workspaceId === workspace.id)
      .map((item) => {
        const asset = workspaceAssets.find((entry) => entry.id === item.assetId);
        const missingImage = item.status === "done" && item.generationType === "image" && !(item.assetUrl || asset?.assetUrl);
        return missingImage ? { ...item, status: "failed" as const, error: "Image generation was marked done before the image provider was connected. Regenerate this item." } : item;
      }),
    automationRules: (db.automationRules || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    automationJobs: (db.automationJobs || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50),
    automationSourceWatchers: (db.automationSourceWatchers || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    automationSourceRuns: (db.automationSourceRuns || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 50),
    billingSettings: db.billingSettings,
    billing: {
      balance: billingBalance,
      currentPlan,
      currentSubscription: currentSubscription ? {
        id: currentSubscription.id,
        planId: currentSubscription.planId,
        status: currentSubscription.status,
        currentPeriodEnd: currentSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: currentSubscription.cancelAtPeriodEnd
      } : null,
      stripeMode,
      stripeCheckoutEnabled,
      plans: billingPlans.map((plan) => ({
        ...plan,
        stripePriceId: stripeCheckoutEnabled ? db.billingStripeCatalogueMappings.find((mapping) => mapping.mode === stripeMode && mapping.itemKind === "plan" && mapping.itemId === plan.id && mapping.active && mapping.status === "synced")?.priceId : undefined
      })),
      creditPackages: billingCreditPackages.map((pkg) => ({
        ...pkg,
        stripePriceId: stripeCheckoutEnabled ? db.billingStripeCatalogueMappings.find((mapping) => mapping.mode === stripeMode && mapping.itemKind === "package" && mapping.itemId === pkg.id && mapping.active && mapping.status === "synced")?.priceId : undefined
      })),
      ledger: billingLedger.slice(0, 200),
      paymentHistory,
      usageByModule: groupUsage(billingLedger, "module"),
      usageByProvider: groupUsage(billingLedger, "provider"),
      subscriptionCredits: sumCredits(activeLedger.filter((entry) => entry.type === "subscription_grant" && entry.status === "succeeded")),
      topUpCredits: sumCredits(activeLedger.filter((entry) => entry.type === "purchase" && entry.status === "succeeded")),
      bonusCredits: sumCredits(activeLedger.filter((entry) => (entry.type === "bonus" || entry.type === "admin_adjustment") && entry.credits > 0 && entry.status === "succeeded")),
      usedCredits: sumCredits(usageEntries),
      reservedCredits: billingBalance.reserved
    },
    activity: db.activity.filter((item) => item.workspaceId === workspace.id).slice(-10).reverse(),
    debugLogs: (db.debugLogs || []).filter((item) => item.workspaceId === workspace.id).slice(-200).reverse(),
    promptTemplates: db.promptTemplates
  };
  return NextResponse.json(scoped);
}
