import crypto from "crypto";
import type {
  BillingStripeLaunchControl,
  Database,
  StripeLiveRolloutStage,
  User
} from "./types";

export const liveReadinessChecklist = [
  { key: "phase10Acceptance", label: "Test-mode acceptance", description: "Phase 10.5 payments, refunds, subscriptions, portal, and duplicate webhook tests passed." },
  { key: "stripeAccountVerified", label: "Stripe account verified", description: "Business and identity verification is complete in Stripe." },
  { key: "payoutBankConfigured", label: "Payout bank configured", description: "The production payout bank account is configured and reviewed." },
  { key: "businessProfileReviewed", label: "Business profile reviewed", description: "Business name, statement descriptor, support details, and branding are correct." },
  { key: "legalPoliciesPublished", label: "Policies published", description: "Terms, privacy, refund, and cancellation policies are publicly available." },
  { key: "paymentsScopeConfirmed", label: "Payment scope confirmed", description: "Supported countries, USD currency, and accepted payment methods are approved." },
  { key: "stripeTaxDecision", label: "Stripe Tax decision recorded", description: "Tax collection requirements were reviewed and configured or explicitly deferred." },
  { key: "productionBackup", label: "Production backup complete", description: "A restorable production database backup and rollback point were created." },
  { key: "receiptsReviewed", label: "Receipts and billing emails reviewed", description: "Stripe receipt, invoice, and failed-payment email settings are ready." },
  { key: "securityReviewed", label: "Security reviewed", description: "2FA, key storage, access permissions, logs, and rotation procedure were reviewed." }
] as const;

export function defaultStripeLaunchControl(): BillingStripeLaunchControl {
  return {
    readiness: liveReadinessChecklist.map((item) => ({ ...item, confirmed: false })),
    rolloutStage: "disabled",
    allowlistedUserIds: [],
    checkoutKillSwitch: true
  };
}

export function ensureStripeLaunchDefaults(db: Database) {
  const existing = db.billingStripeLaunchControl || defaultStripeLaunchControl();
  const byKey = new Map((existing.readiness || []).map((item) => [item.key, item]));
  db.billingStripeLaunchControl = {
    ...defaultStripeLaunchControl(),
    ...existing,
    readiness: liveReadinessChecklist.map((definition) => ({
      ...definition,
      confirmed: Boolean(byKey.get(definition.key)?.confirmed),
      note: byKey.get(definition.key)?.note,
      confirmedAt: byKey.get(definition.key)?.confirmedAt,
      confirmedBy: byKey.get(definition.key)?.confirmedBy
    })),
    allowlistedUserIds: Array.from(new Set((existing.allowlistedUserIds || []).map(String))).filter(Boolean)
  };
  db.billingStripeLaunchReports ||= [];
}

export function stripeOfferFingerprint(db: Database) {
  const offers = [
    ...db.billingPlans.filter((item) => item.active).map((item) => ({
      kind: "plan",
      id: item.id,
      name: item.name,
      priceUsd: item.priceUsd,
      baseCredits: item.baseCredits,
      bonusPercent: item.bonusPercent,
      totalCredits: item.totalCredits,
      expiryDays: item.expiryDays,
      interval: "month"
    })),
    ...db.billingCreditPackages.filter((item) => item.active).map((item) => ({
      kind: "package",
      id: item.id,
      name: item.name,
      priceUsd: item.priceUsd,
      baseCredits: item.baseCredits,
      bonusPercent: item.bonusPercent,
      totalCredits: item.totalCredits,
      expiryDays: item.expiresAfterDays || null,
      interval: null
    }))
  ].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  return crypto.createHash("sha256").update(JSON.stringify(offers)).digest("hex");
}

export function liveCatalogueComparison(db: Database) {
  const offers = [
    ...db.billingPlans.filter((item) => item.active).map((item) => ({ kind: "plan" as const, item })),
    ...db.billingCreditPackages.filter((item) => item.active).map((item) => ({ kind: "package" as const, item }))
  ];
  return offers.map(({ kind, item }) => {
    const test = db.billingStripeCatalogueMappings.find((mapping) => mapping.mode === "test" && mapping.itemKind === kind && mapping.itemId === item.id && mapping.active);
    const live = db.billingStripeCatalogueMappings.find((mapping) => mapping.mode === "live" && mapping.itemKind === kind && mapping.itemId === item.id && mapping.active);
    const liveRevision = live ? db.billingStripeCatalogueRevisions.find((revision) => revision.id === live.revisionId) : undefined;
    const bonusCredits = Math.max(0, item.totalCredits - item.baseCredits);
    const expectedInterval = kind === "plan" ? "month" : undefined;
    const matches = Boolean(live && liveRevision
      && live.status === "synced"
      && live.amountUsd === item.priceUsd
      && live.interval === expectedInterval
      && liveRevision.itemName === item.name
      && liveRevision.baseCredits === item.baseCredits
      && liveRevision.bonusCredits === bonusCredits
      && liveRevision.totalCredits === item.totalCredits);
    return {
      itemKind: kind,
      itemId: item.id,
      name: item.name,
      priceUsd: item.priceUsd,
      interval: expectedInterval,
      baseCredits: item.baseCredits,
      bonusCredits,
      totalCredits: item.totalCredits,
      testPriceId: test?.priceId,
      testStatus: test?.status || "not_synced",
      liveProductId: live?.productId,
      livePriceId: live?.priceId,
      liveStatus: live?.status || "not_synced",
      matches
    };
  });
}

export function liveLaunchPreflight(db: Database) {
  ensureStripeLaunchDefaults(db);
  const launch = db.billingStripeLaunchControl;
  const live = db.billingStripeConnections.find((item) => item.mode === "live");
  const comparison = liveCatalogueComparison(db);
  const fingerprint = stripeOfferFingerprint(db);
  const checks = [
    { key: "readiness", label: "Readiness approved", passed: Boolean(launch.readinessApprovedAt), detail: launch.readinessApprovedAt ? `Approved ${launch.readinessApprovedAt}` : "Owner approval is missing." },
    { key: "liveConnection", label: "Live account connected", passed: live?.status === "connected", detail: live?.status === "connected" ? String(live.accountId || "Connected") : "Live Stripe is disconnected." },
    { key: "charges", label: "Charges enabled", passed: Boolean(live?.chargesEnabled), detail: live?.chargesEnabled ? "Stripe reports charges enabled." : "Stripe charges are not enabled." },
    { key: "payouts", label: "Payouts enabled", passed: Boolean(live?.payoutsEnabled), detail: live?.payoutsEnabled ? "Stripe reports payouts enabled." : "Stripe payouts are not enabled." },
    { key: "webhook", label: "Live webhook configured", passed: live?.webhookStatus === "configured", detail: live?.webhookStatus === "configured" ? String(live.webhookUrl || "Configured") : "Live webhook is missing or unhealthy." },
    { key: "catalogue", label: "Live catalogue synchronized", passed: comparison.length > 0 && comparison.every((item) => item.matches), detail: `${comparison.filter((item) => item.matches).length}/${comparison.length} offers match.` },
    { key: "catalogueApproval", label: "Live catalogue approved", passed: Boolean(launch.liveCatalogueApprovedAt && launch.liveCatalogueFingerprint === fingerprint), detail: launch.liveCatalogueApprovedAt && launch.liveCatalogueFingerprint === fingerprint ? `Approved ${launch.liveCatalogueApprovedAt}` : "Approve the current live catalogue fingerprint." },
    { key: "https", label: "HTTPS endpoints", passed: String(live?.webhookUrl || "").startsWith("https://"), detail: String(live?.webhookUrl || "Live webhook URL is missing.") },
    { key: "rollout", label: "Controlled rollout selected", passed: launch.rolloutStage !== "disabled", detail: `Rollout stage: ${stageLabel(launch.rolloutStage)}.` }
  ];
  return { passed: checks.every((check) => check.passed), checks, comparison, fingerprint };
}

export function liveCheckoutAccess(db: Database, user: User) {
  ensureStripeLaunchDefaults(db);
  const launch = db.billingStripeLaunchControl;
  const stage = launch.rolloutStage;
  if (!launch.readinessApprovedAt) return { allowed: false, reason: "Live Checkout readiness approval is missing.", stage };
  if (!launch.liveCatalogueApprovedAt || launch.liveCatalogueFingerprint !== stripeOfferFingerprint(db)) return { allowed: false, reason: "The current live catalogue has not been approved.", stage };
  if (launch.checkoutKillSwitch) return { allowed: false, reason: "Live Checkout is paused by the billing kill switch.", stage };
  if (stage === "disabled") return { allowed: false, reason: "Live Checkout rollout is disabled.", stage };
  if (stage === "owner_only") return { allowed: ["owner", "super_admin"].includes(user.role), reason: "Live Checkout is limited to owner accounts.", stage };
  if (stage === "internal") return { allowed: ["owner", "super_admin", "admin", "support_admin"].includes(user.role), reason: "Live Checkout is limited to internal accounts.", stage };
  if (stage === "allowlist") return { allowed: launch.allowlistedUserIds.includes(user.id) || ["owner", "super_admin"].includes(user.role), reason: "Live Checkout is limited to allowlisted accounts.", stage };
  return { allowed: Boolean(user.emailVerified), reason: "Live Checkout requires a verified email address.", stage };
}

export function stageLabel(stage: StripeLiveRolloutStage) {
  return ({ disabled: "Disabled", owner_only: "Owner only", internal: "Internal admins", allowlist: "Allowlist", all_verified: "All verified users" })[stage];
}
