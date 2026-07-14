import crypto from "crypto";
import type {
  BillingCreditPackage,
  BillingLedgerEntry,
  BillingPlan,
  BillingProvider,
  BillingProviderMapping,
  BillingQuote,
  BillingRateCard,
  BillingRateUnit,
  BillingSettings,
  Database
} from "./types";

export const defaultBillingSettings: BillingSettings = {
  creditScale: 1000,
  defaultMarkupMultiplier: 2,
  currency: "USD",
  lowCreditThreshold: 1000,
  automationMinimumBalance: 3500,
  automationDefaultRunCap: 12000,
  automationDefaultMonthlyCap: 240000,
  dailySpendLimitCredits: 50000,
  monthlySpendLimitCredits: 240000,
  maxConcurrentGenerations: 2,
  failedGenerationRefundPolicy: "refund_if_provider_failed",
  stripeMode: "test",
  stripeCheckoutEnabled: { test: false, live: false },
  allowNegativeBalance: false
};

export const defaultBillingPlans: BillingPlan[] = [
  { id: "plan_starter_20", name: "Starter", priceUsd: 20, baseCredits: 20000, bonusPercent: 0, totalCredits: 20000, expiryDays: 90, active: true, automationAllowed: false, maxConcurrentGenerations: 1 },
  { id: "plan_growth_50", name: "Growth", priceUsd: 50, baseCredits: 50000, bonusPercent: 10, totalCredits: 55000, expiryDays: 90, active: true, automationAllowed: true, maxConcurrentGenerations: 2 },
  { id: "plan_pro_100", name: "Pro", priceUsd: 100, baseCredits: 100000, bonusPercent: 20, totalCredits: 120000, expiryDays: 90, active: true, automationAllowed: true, maxConcurrentGenerations: 4 }
];

export const defaultBillingCreditPackages: BillingCreditPackage[] = [
  { id: "pkg_mini_5", name: "Mini Top-up", priceUsd: 5, baseCredits: 5000, bonusPercent: 0, bonusCredits: 0, totalCredits: 5000, active: true },
  { id: "pkg_small_10", name: "Small Top-up", priceUsd: 10, baseCredits: 10000, bonusPercent: 0, bonusCredits: 0, totalCredits: 10000, active: true },
  { id: "pkg_growth_50", name: "Growth Top-up", priceUsd: 50, baseCredits: 50000, bonusPercent: 10, bonusCredits: 5000, totalCredits: 55000, active: true },
  { id: "pkg_pro_100", name: "Pro Top-up", priceUsd: 100, baseCredits: 100000, bonusPercent: 20, bonusCredits: 20000, totalCredits: 120000, active: true },
  { id: "pkg_scale_200", name: "Scale Top-up", priceUsd: 200, baseCredits: 200000, bonusPercent: 30, bonusCredits: 60000, totalCredits: 260000, active: true }
];

const defaultBillingProviderMappingSeeds: Omit<BillingProviderMapping, "active">[] = [
  { id: "map_veo_fast", uiKey: "veo-fast", provider: "kie", providerModelOrActorId: "veo3_fast", actionType: "video_generation", label: "VEO Fast" },
  { id: "map_seedance_2", uiKey: "seedance-2.0", provider: "kie", providerModelOrActorId: "bytedance/seedance-2", actionType: "video_generation", label: "Seedance 2.0" },
  { id: "map_gpt_image_2", uiKey: "gpt-image-2", provider: "kie", providerModelOrActorId: "gpt-image-2", actionType: "image_generation", label: "GPT Image 2" },
  { id: "map_nanobanana_pro", uiKey: "nanobanana-pro", provider: "kie", providerModelOrActorId: "nano-banana-pro", actionType: "image_generation", label: "Nano Banana Pro" },
  { id: "map_gpt_55", uiKey: "gpt-5-5", provider: "kie", providerModelOrActorId: "gpt-5.5", actionType: "text_generation", label: "GPT-5.5" },
  { id: "map_gemini_flash", uiKey: "gemini-3.5-flash", provider: "kie", providerModelOrActorId: "gemini-3.5-flash", actionType: "text_generation", label: "Gemini 3.5 Flash" },
  { id: "map_claude_opus_48", uiKey: "claude-opus-4.8", provider: "kie", providerModelOrActorId: "claude-opus-4.8", actionType: "text_generation", label: "Claude Opus 4.8" },
  { id: "map_instagram_scrape", uiKey: "instagram-scrape", provider: "apify", providerModelOrActorId: "apify/instagram-scraper", actionType: "scrape", label: "Instagram scrape" },
  { id: "map_instagram_hashtag", uiKey: "instagram-hashtag", provider: "apify", providerModelOrActorId: "apify/instagram-hashtag-scraper", actionType: "scrape", label: "Instagram hashtag scrape" },
  { id: "map_tiktok_scrape", uiKey: "tiktok-scrape", provider: "apify", providerModelOrActorId: "clockworks/tiktok-scraper", actionType: "scrape", label: "TikTok scrape" },
  { id: "map_youtube_scrape", uiKey: "youtube-scrape", provider: "apify", providerModelOrActorId: "streamers/youtube-scraper", actionType: "scrape", label: "YouTube scrape" },
  { id: "map_facebook_scrape", uiKey: "facebook-scrape", provider: "apify", providerModelOrActorId: "scrapeforge/facebook-search-posts", actionType: "scrape", label: "Facebook scrape" },
  { id: "map_google_search_scrape", uiKey: "google-search-scrape", provider: "apify", providerModelOrActorId: "apify/google-search-scraper", actionType: "scrape", label: "Google Search scrape" },
  { id: "map_upload_post", uiKey: "upload-post-publish", provider: "upload-post", providerModelOrActorId: "upload-post", actionType: "publish", label: "Upload-Post publish" }
];

export const defaultBillingProviderMappings: BillingProviderMapping[] = defaultBillingProviderMappingSeeds.map((mapping) => ({ ...mapping, active: true }));

export const defaultBillingRateCards: BillingRateCard[] = [
  rate("rate_kie_veo_fast_720p", "kie", "video_generation", "veo3_fast", "VEO Fast 720p video", "per_action", 0.30, 2, 1, { resolution: "720p" }),
  rate("rate_kie_seedance_2_720p", "kie", "video_generation", "bytedance/seedance-2", "Seedance 2.0 720p", "per_second", 0.205, 2, 1, { resolution: "720p" }),
  rate("rate_kie_gpt_image_2_1k", "kie", "image_generation", "gpt-image-2:1k", "GPT Image 2 1K", "per_image", 0.03, 2, 1, { model: "gpt-image-2", resolution: "1K" }),
  rate("rate_kie_gpt_image_2_2k", "kie", "image_generation", "gpt-image-2:2k", "GPT Image 2 2K", "per_image", 0.05, 2, 1, { model: "gpt-image-2", resolution: "2K" }),
  rate("rate_kie_gpt_image_2_4k", "kie", "image_generation", "gpt-image-2:4k", "GPT Image 2 4K", "per_image", 0.08, 2, 1, { model: "gpt-image-2", resolution: "4K" }),
  rate("rate_kie_nano_banana_pro_1_2k", "kie", "image_generation", "nano-banana-pro:1-2k", "Nano Banana Pro 1/2K", "per_image", 0.09, 2, 1, { model: "nano-banana-pro", resolution: "1/2K" }),
  rate("rate_kie_nano_banana_pro_4k", "kie", "image_generation", "nano-banana-pro:4k", "Nano Banana Pro 4K", "per_image", 0.12, 2, 1, { model: "nano-banana-pro", resolution: "4K" }),
  rate("rate_kie_gpt_55_input", "kie", "text_generation", "gpt-5.5:input", "GPT-5.5 input", "per_1k_tokens", 0.0014, 2, 1, { model: "gpt-5.5", tokenRole: "input" }),
  rate("rate_kie_gpt_55_output", "kie", "text_generation", "gpt-5.5:output", "GPT-5.5 output", "per_1k_tokens", 0.0084, 2, 1, { model: "gpt-5.5", tokenRole: "output" }),
  rate("rate_kie_gemini_flash_input", "kie", "text_generation", "gemini-3.5-flash:input", "Gemini 3.5 Flash input", "per_1k_tokens", 0.00045, 2, 1, { model: "gemini-3.5-flash", tokenRole: "input" }),
  rate("rate_kie_gemini_flash_output", "kie", "text_generation", "gemini-3.5-flash:output", "Gemini 3.5 Flash output", "per_1k_tokens", 0.0027, 2, 1, { model: "gemini-3.5-flash", tokenRole: "output" }),
  rate("rate_kie_claude_opus_48_input", "kie", "text_generation", "claude-opus-4.8:input", "Claude Opus 4.8 input", "per_1k_tokens", 0.002, 2, 1, { model: "claude-opus-4.8", tokenRole: "input" }),
  rate("rate_kie_claude_opus_48_output", "kie", "text_generation", "claude-opus-4.8:output", "Claude Opus 4.8 output", "per_1k_tokens", 0.010, 2, 1, { model: "claude-opus-4.8", tokenRole: "output" }),
  rate("rate_apify_instagram", "apify", "scrape", "apify/instagram-scraper", "Instagram scraper", "per_1k_results", 2.70, 2, 1),
  rate("rate_apify_instagram_hashtag", "apify", "scrape", "apify/instagram-hashtag-scraper", "Instagram hashtag scraper", "per_1k_results", 2.60, 2, 1),
  rate("rate_apify_tiktok", "apify", "scrape", "clockworks/tiktok-scraper", "TikTok scraper", "per_1k_results", 1.70, 2, 1),
  rate("rate_apify_youtube", "apify", "scrape", "streamers/youtube-scraper", "YouTube scraper", "per_1k_results", 2.40, 2, 1),
  rate("rate_apify_facebook", "apify", "scrape", "scrapeforge/facebook-search-posts", "Facebook search posts", "per_1k_results", 2.59, 2, 1),
  rate("rate_apify_google_search", "apify", "scrape", "apify/google-search-scraper", "Google Search scraper", "per_1k_results", 1.50, 2, 1),
  rate("rate_upload_post_publish", "upload-post", "publish", "upload-post", "Upload-Post publish included", "per_post", 0, 2, 0, { included: true }),
  rate("rate_brevo_verification", "brevo", "publish", "brevo-verification-email", "Brevo verification email included", "per_action", 0, 2, 0, { included: true })
];

function rate(
  id: string,
  provider: BillingProvider,
  actionType: BillingRateCard["actionType"],
  modelOrActorId: string,
  label: string,
  unit: BillingRateUnit,
  baseCostUsd: number,
  markupMultiplier: number,
  minimumChargeCredits: number,
  metadata?: Record<string, unknown>
): BillingRateCard {
  return { id, provider, actionType, modelOrActorId, label, unit, baseCostUsd, markupMultiplier, minimumChargeCredits, roundingMode: "ceil", active: true, source: "manual", metadata };
}

export function ensureBillingDefaults(db: Database) {
  const previousSettings = db.billingSettings || {};
  db.billingSettings = { ...defaultBillingSettings, ...previousSettings };
  db.billingSettings.stripeCheckoutEnabled = {
    test: Boolean(previousSettings.stripeCheckoutEnabled?.test),
    live: Boolean(previousSettings.stripeCheckoutEnabled?.live)
  };
  if (!Object.prototype.hasOwnProperty.call(previousSettings, "automationDefaultMonthlyCap")) {
    db.billingSettings.automationDefaultMonthlyCap = defaultBillingSettings.automationDefaultMonthlyCap;
    if (!previousSettings.automationDefaultRunCap || previousSettings.automationDefaultRunCap <= 3500) {
      db.billingSettings.automationDefaultRunCap = defaultBillingSettings.automationDefaultRunCap;
    }
  }
  db.billingRateCards = mergeById(defaultBillingRateCards, db.billingRateCards || []);
  db.billingProviderMappings = mergeById(defaultBillingProviderMappings, db.billingProviderMappings || []);
  db.billingPlans = mergeById(defaultBillingPlans, db.billingPlans || []).map(recalculatePlanCredits);
  db.billingCreditPackages = mergeById(defaultBillingCreditPackages, db.billingCreditPackages || []).map(recalculatePackageCredits);
  db.billingStripeCatalogueMappings ||= [];
  db.billingStripeCatalogueRevisions ||= [];
  db.billingCheckoutOrders ||= [];
  db.billingStripeSubscriptionMigrations ||= [];
  for (const mapping of db.billingStripeCatalogueMappings) {
    if (!mapping.active) continue;
    const item = mapping.itemKind === "plan"
      ? db.billingPlans.find((plan) => plan.id === mapping.itemId)
      : db.billingCreditPackages.find((pkg) => pkg.id === mapping.itemId);
    if (!item) {
      mapping.status = "error";
      mapping.error = "The mapped Content Agent offer no longer exists.";
      continue;
    }
    const expectedInterval = mapping.itemKind === "plan" ? "month" : undefined;
    if (mapping.amountUsd !== item.priceUsd || mapping.interval !== expectedInterval) mapping.status = "out_of_sync";
  }
  db.billingLedger ||= [];
  for (const workspace of db.workspaces || []) {
    const openingId = `cred_opening_${workspace.id}`;
    if (workspace.credits > 0 && !db.billingLedger.some((entry) => entry.id === openingId)) {
      db.billingLedger.unshift({
        id: openingId,
        workspaceId: workspace.id,
        type: "bonus",
        module: "billing",
        provider: "local",
        action: "opening_balance",
        credits: workspace.credits,
        usdCost: 0,
        markup: 0,
        status: "succeeded",
        description: "Opening balance imported from workspace credits.",
        createdAt: new Date().toISOString(),
        metadata: { importedFromWorkspaceCredits: true }
      });
    }
    workspace.credits = calculateCreditBalance(db, workspace.id).available;
  }
}

function currentMonthStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function automationMonthlyUsageCredits(db: Pick<Database, "billingLedger">, input: { workspaceId: string; automationId?: string }) {
  const start = currentMonthStartIso();
  const automationId = input.automationId || "";
  return (db.billingLedger || [])
    .filter((entry) => entry.workspaceId === input.workspaceId)
    .filter((entry) => entry.type === "usage" && entry.status === "succeeded")
    .filter((entry) => entry.module === "automation")
    .filter((entry) => !entry.createdAt || entry.createdAt >= start)
    .filter((entry) => {
      if (!automationId) return true;
      const metadata = entry.metadata || {};
      return metadata.automationId === automationId || metadata.watcherId === automationId || metadata.ruleId === automationId;
    })
    .reduce((sum, entry) => sum + Math.abs(Math.ceil(entry.credits || 0)), 0);
}

export function automationBillingPolicy(db: Database, input: { workspaceId: string; automationId?: string; maxCreditsPerRun?: number; monthlyCreditCap?: number }) {
  ensureBillingDefaults(db);
  const balance = calculateCreditBalance(db, input.workspaceId);
  const maxCreditsPerRun = Math.max(1, Math.ceil(Number(input.maxCreditsPerRun || db.billingSettings.automationDefaultRunCap || defaultBillingSettings.automationDefaultRunCap)));
  const monthlyCreditCap = Math.max(0, Math.ceil(Number(input.monthlyCreditCap || db.billingSettings.automationDefaultMonthlyCap || defaultBillingSettings.automationDefaultMonthlyCap)));
  const monthlyUsed = automationMonthlyUsageCredits(db, { workspaceId: input.workspaceId, automationId: input.automationId });
  return {
    minimumBalance: Math.max(0, Math.ceil(Number(db.billingSettings.automationMinimumBalance || 0))),
    maxCreditsPerRun,
    monthlyCreditCap,
    monthlyUsed,
    monthlyRemaining: monthlyCreditCap > 0 ? Math.max(0, monthlyCreditCap - monthlyUsed) : Number.POSITIVE_INFINITY,
    balanceAvailable: balance.available,
    balanceReserved: balance.reserved
  };
}

export function assertAutomationCanSpend(db: Database, input: {
  workspaceId: string;
  automationId?: string;
  maxCreditsPerRun?: number;
  monthlyCreditCap?: number;
  estimatedCredits?: number;
  runReservedCredits?: number;
  actionLabel?: string;
}) {
  const policy = automationBillingPolicy(db, input);
  const estimatedCredits = Math.max(0, Math.ceil(Number(input.estimatedCredits || 0)));
  const runReservedCredits = Math.max(0, Math.ceil(Number(input.runReservedCredits || 0)));
  const actionLabel = input.actionLabel || "Automation run";
  if (policy.balanceAvailable < policy.minimumBalance) {
    throw new Error(`${actionLabel} blocked: available balance ${policy.balanceAvailable.toLocaleString()} is below the automation minimum ${policy.minimumBalance.toLocaleString()} credits.`);
  }
  if (estimatedCredits > 0 && runReservedCredits + estimatedCredits > policy.maxCreditsPerRun) {
    throw new Error(`${actionLabel} blocked: estimated ${estimatedCredits.toLocaleString()} credits would exceed the per-run cap ${policy.maxCreditsPerRun.toLocaleString()} credits.`);
  }
  if (estimatedCredits > 0 && policy.monthlyCreditCap > 0 && policy.monthlyUsed + runReservedCredits + estimatedCredits > policy.monthlyCreditCap) {
    throw new Error(`${actionLabel} blocked: monthly automation cap ${policy.monthlyCreditCap.toLocaleString()} credits would be exceeded. Used ${policy.monthlyUsed.toLocaleString()} credits this month.`);
  }
  return policy;
}

function mergeById<T extends { id: string }>(defaults: T[], existing: T[]) {
  const map = new Map(defaults.map((item) => [item.id, item]));
  for (const item of existing) map.set(item.id, { ...(map.get(item.id) || {}), ...item });
  return Array.from(map.values());
}

export function recalculatePlanCredits(plan: BillingPlan): BillingPlan {
  const bonus = Math.ceil(plan.baseCredits * (plan.bonusPercent || 0) / 100);
  return { ...plan, totalCredits: plan.baseCredits + bonus };
}

export function recalculatePackageCredits(pkg: BillingCreditPackage): BillingCreditPackage {
  const bonusCredits = Number.isFinite(pkg.bonusCredits) && pkg.bonusCredits > 0
    ? Math.ceil(pkg.bonusCredits)
    : Math.ceil(pkg.baseCredits * (pkg.bonusPercent || 0) / 100);
  return { ...pkg, bonusCredits, totalCredits: pkg.baseCredits + bonusCredits };
}

export function calculateCreditBalance(db: Pick<Database, "billingLedger">, workspaceId: string) {
  const now = Date.now();
  let available = 0;
  let reserved = 0;
  let lifetimeGranted = 0;
  let lifetimeUsed = 0;
  for (const entry of db.billingLedger || []) {
    if (entry.workspaceId !== workspaceId) continue;
    const expired = entry.expiresAt ? new Date(entry.expiresAt).getTime() < now : false;
    if (expired && ["purchase", "subscription_grant", "bonus", "admin_adjustment"].includes(entry.type)) continue;
    const credits = Math.round(entry.credits || 0);
    if (entry.type === "reserve" && entry.status === "reserved") {
      reserved += Math.abs(credits);
      continue;
    }
    if (["failed", "refunded"].includes(entry.status)) continue;
    if (entry.type === "usage") {
      available -= Math.abs(credits);
      lifetimeUsed += Math.abs(credits);
    } else if (entry.type === "reserve") {
      continue;
    } else {
      available += credits;
      if (credits > 0) lifetimeGranted += credits;
    }
  }
  return { available: Math.max(0, available - reserved), reserved, lifetimeGranted, lifetimeUsed };
}

export function createLedgerId() {
  return `cred_${crypto.randomBytes(6).toString("hex")}`;
}

export type BillingReservationResult = {
  quote: BillingQuote;
  reservation: BillingLedgerEntry | null;
};

export function reserveBillingCredits(db: Database, input: {
  userId?: string;
  workspaceId: string;
  quoteInput: Record<string, unknown>;
  relatedId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): BillingReservationResult {
  ensureBillingDefaults(db);
  const quote = quoteBillingAction(db, { ...input.quoteInput, workspaceId: input.workspaceId });
  const credits = Math.max(0, Math.ceil(quote.maxCredits || quote.credits || 0));
  if (credits <= 0) return { quote, reservation: null };
  const balance = calculateCreditBalance(db, input.workspaceId);
  if (!db.billingSettings.allowNegativeBalance && balance.available < credits) {
    throw new Error(`Insufficient credits. Need ${credits.toLocaleString()} credits, available ${balance.available.toLocaleString()}.`);
  }
  const reservation: BillingLedgerEntry = {
    id: createLedgerId(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: "reserve",
    module: quote.module,
    provider: quote.provider,
    action: quote.action,
    credits,
    usdCost: quote.costUsd,
    markup: quote.costUsd > 0 ? quote.chargeUsd / quote.costUsd : 0,
    status: "reserved",
    relatedId: input.relatedId,
    description: input.description || `Reserved ${credits.toLocaleString()} credits for ${quote.action}.`,
    metadata: {
      ...(input.metadata || {}),
      quote,
      reservedCredits: credits
    },
    createdAt: new Date().toISOString()
  };
  db.billingLedger.push(reservation);
  updateWorkspaceCreditBalance(db, input.workspaceId);
  return { quote, reservation };
}

export function settleBillingReservation(db: Database, input: {
  reservationId?: string;
  actualCredits?: number;
  providerTaskId?: string;
  relatedId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.reservationId) return null;
  ensureBillingDefaults(db);
  const reservation = db.billingLedger.find((entry) => entry.id === input.reservationId && entry.type === "reserve");
  if (!reservation) throw new Error("Billing reservation not found.");
  if (reservation.status !== "reserved") return reservation;
  const reservedCredits = Math.max(0, Math.ceil(Math.abs(reservation.credits || 0)));
  const requestedActual = Number.isFinite(input.actualCredits) ? Math.max(0, Math.ceil(Number(input.actualCredits))) : reservedCredits;
  const actualCredits = Math.min(reservedCredits, requestedActual);
  reservation.status = "released";
  reservation.providerTaskId = input.providerTaskId || reservation.providerTaskId;
  reservation.relatedId = input.relatedId || reservation.relatedId;
  reservation.metadata = {
    ...(reservation.metadata || {}),
    ...(input.metadata || {}),
    settledAt: new Date().toISOString(),
    actualCredits,
    requestedActualCredits: requestedActual,
    releasedCredits: Math.max(0, reservedCredits - actualCredits)
  };
  if (actualCredits > 0) {
    const chargeUsd = Number((reservation.metadata as Record<string, unknown> | undefined)?.quote && typeof (reservation.metadata as Record<string, unknown>).quote === "object"
      ? ((reservation.metadata as Record<string, unknown>).quote as BillingQuote).chargeUsd
      : actualCredits / db.billingSettings.creditScale);
    db.billingLedger.push({
      id: createLedgerId(),
      userId: reservation.userId,
      workspaceId: reservation.workspaceId,
      type: "usage",
      module: reservation.module,
      provider: reservation.provider,
      action: reservation.action,
      credits: actualCredits,
      usdCost: reservation.usdCost,
      markup: reservation.markup,
      status: "succeeded",
      relatedId: input.relatedId || reservation.relatedId,
      providerTaskId: input.providerTaskId || reservation.providerTaskId,
      description: input.description || `Charged ${actualCredits.toLocaleString()} credits for ${reservation.action}.`,
      metadata: {
        ...(input.metadata || {}),
        reservationId: reservation.id,
        reservedCredits,
        releasedCredits: Math.max(0, reservedCredits - actualCredits),
        chargeUsd
      },
      createdAt: new Date().toISOString()
    });
  }
  if (reservedCredits > actualCredits) appendZeroCreditRelease(db, reservation, {
    providerTaskId: input.providerTaskId,
    relatedId: input.relatedId,
    description: `Released ${(reservedCredits - actualCredits).toLocaleString()} unused reserved credits for ${reservation.action}.`,
    metadata: { releasedCredits: reservedCredits - actualCredits, reservationId: reservation.id }
  });
  updateWorkspaceCreditBalance(db, reservation.workspaceId);
  return reservation;
}

export function releaseBillingReservation(db: Database, input: {
  reservationId?: string;
  providerTaskId?: string;
  relatedId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.reservationId) return null;
  ensureBillingDefaults(db);
  const reservation = db.billingLedger.find((entry) => entry.id === input.reservationId && entry.type === "reserve");
  if (!reservation) throw new Error("Billing reservation not found.");
  if (reservation.status !== "reserved") return reservation;
  const reservedCredits = Math.max(0, Math.ceil(Math.abs(reservation.credits || 0)));
  reservation.status = "released";
  reservation.providerTaskId = input.providerTaskId || reservation.providerTaskId;
  reservation.relatedId = input.relatedId || reservation.relatedId;
  reservation.metadata = {
    ...(reservation.metadata || {}),
    ...(input.metadata || {}),
    releasedAt: new Date().toISOString(),
    releasedCredits: reservedCredits
  };
  appendZeroCreditRelease(db, reservation, {
    providerTaskId: input.providerTaskId,
    relatedId: input.relatedId,
    description: input.description || `Released ${reservedCredits.toLocaleString()} reserved credits for ${reservation.action}.`,
    metadata: { ...(input.metadata || {}), releasedCredits: reservedCredits, reservationId: reservation.id }
  });
  updateWorkspaceCreditBalance(db, reservation.workspaceId);
  return reservation;
}

export function updateWorkspaceCreditBalance(db: Pick<Database, "billingLedger" | "workspaces">, workspaceId: string) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (workspace) workspace.credits = calculateCreditBalance(db, workspaceId).available;
}

function appendZeroCreditRelease(db: Database, reservation: BillingLedgerEntry, input: { providerTaskId?: string; relatedId?: string; description: string; metadata?: Record<string, unknown> }) {
  db.billingLedger.push({
    id: createLedgerId(),
    userId: reservation.userId,
    workspaceId: reservation.workspaceId,
    type: "release",
    module: reservation.module,
    provider: reservation.provider,
    action: reservation.action,
    credits: 0,
    usdCost: 0,
    markup: 0,
    status: "released",
    relatedId: input.relatedId || reservation.relatedId,
    providerTaskId: input.providerTaskId || reservation.providerTaskId,
    description: input.description,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  });
}

export function quoteBillingAction(db: Database, input: Record<string, unknown>): BillingQuote {
  const action = String(input.action || "");
  const moduleName = String(input.module || inferModule(action));
  const generationType = String(input.generationType || "");
  const model = String(input.model || input.modelOrActorId || defaultModelForAction(action, generationType));
  const actorId = String(input.actorId || input.modelOrActorId || "");
  if (action === "persona.autofill") return quotePersonaAutofill(db, input);
  if (action.includes("scrape") || action.includes("scan") || action.includes("search") || input.provider === "apify") {
    return quoteScrape(db, { action, moduleName, actorId, platform: String(input.platform || ""), maxResults: Number(input.maxResults || input.resultLimit || 100) });
  }
  if (action.includes("publish") || input.provider === "upload-post") {
    return quoteSingleRate(db, { action, moduleName, provider: "upload-post", actionType: "publish", modelOrActorId: "upload-post", unitCount: Number(input.posts || 1), estimate: false });
  }
  if (generationType === "image" || action.includes("image")) return quoteImage(db, action, moduleName, model, String(input.resolution || "1K"));
  if (generationType === "video" || action.includes("video")) return quoteVideo(db, action, moduleName, model, Number(input.duration || 8));
  if (generationType === "text" || action.includes("ai") || action.includes("text") || action.includes("persona")) {
    return quoteText(db, action, moduleName, model, Number(input.inputTokens || 2000), Number(input.outputTokens || 1000));
  }
  return quoteText(db, action || "billing.unknown", moduleName, model || "gemini-3.5-flash", Number(input.inputTokens || 1000), Number(input.outputTokens || 500));
}

function inferModule(action: string) {
  if (action.startsWith("research")) return "research";
  if (action.startsWith("persona")) return "persona";
  if (action.startsWith("social_audit")) return "social_audit";
  if (action.startsWith("automation")) return "automation";
  if (action.startsWith("publish")) return "publish";
  return "create_content";
}

function defaultModelForAction(action: string, generationType: string) {
  if (generationType === "image") return "gpt-image-2";
  if (generationType === "video") return "veo-fast";
  if (generationType === "text") return "gemini-3.5-flash";
  if (action.includes("persona") || action.includes("prompt") || action.includes("ai")) return "gpt-5-5";
  return "gemini-3.5-flash";
}

function quoteVideo(db: Database, action: string, moduleName: string, model: string, duration: number) {
  const mapped = mapUiModel(db, model);
  const isSeedance = mapped.providerModelOrActorId.includes("seedance");
  return quoteSingleRate(db, {
    action,
    moduleName,
    provider: "kie",
    actionType: "video_generation",
    modelOrActorId: mapped.providerModelOrActorId,
    unitCount: isSeedance ? Math.max(1, Math.round(duration || 8)) : 1,
    estimate: false
  });
}

function quoteImage(db: Database, action: string, moduleName: string, model: string, resolution: string) {
  const mapped = mapUiModel(db, model);
  const normalizedResolution = resolution.toLowerCase().replace(/\s+/g, "");
  const suffix = normalizedResolution === "4k" ? "4k" : normalizedResolution === "2k" ? "2k" : mapped.providerModelOrActorId.includes("nano") ? "1-2k" : "1k";
  return quoteSingleRate(db, {
    action,
    moduleName,
    provider: "kie",
    actionType: "image_generation",
    modelOrActorId: `${mapped.providerModelOrActorId}:${suffix}`,
    unitCount: 1,
    estimate: false
  });
}

function quoteText(db: Database, action: string, moduleName: string, model: string, inputTokens: number, outputTokens: number): BillingQuote {
  const mapped = mapUiModel(db, model);
  const inputRate = findRate(db, "kie", "text_generation", `${mapped.providerModelOrActorId}:input`);
  const outputRate = findRate(db, "kie", "text_generation", `${mapped.providerModelOrActorId}:output`);
  const inputUnits = Math.max(1, Math.ceil(inputTokens / 1000));
  const outputUnits = Math.max(1, Math.ceil(outputTokens / 1000));
  const inputLine = quoteLine(db, inputRate, inputUnits);
  const outputLine = quoteLine(db, outputRate, outputUnits);
  const credits = inputLine.credits + outputLine.credits;
  const costUsd = roundUsd(inputLine.costUsd + outputLine.costUsd);
  const chargeUsd = roundUsd(credits / db.billingSettings.creditScale);
  return {
    action,
    module: moduleName,
    provider: "kie",
    modelOrActorId: mapped.providerModelOrActorId,
    credits,
    minCredits: credits,
    maxCredits: credits,
    costUsd,
    chargeUsd,
    unit: "per_1k_tokens",
    unitCount: inputUnits + outputUnits,
    isEstimate: true,
    label: `${credits.toLocaleString()} credits est.`,
    rateCardId: `${inputRate.id},${outputRate.id}`,
    breakdown: [
      { label: inputRate.label, credits: inputLine.credits, costUsd: inputLine.costUsd, unit: inputRate.unit, unitCount: inputUnits },
      { label: outputRate.label, credits: outputLine.credits, costUsd: outputLine.costUsd, unit: outputRate.unit, unitCount: outputUnits }
    ]
  };
}

function quoteScrape(db: Database, input: { action: string; moduleName: string; actorId: string; platform: string; maxResults: number }) {
  const actorId = input.actorId || actorForPlatform(input.platform);
  const maxResults = Math.max(1, input.maxResults || 100);
  const units = Math.max(1, Math.ceil(maxResults / 1000));
  const quote = quoteSingleRate(db, {
    action: input.action || "research.scan",
    moduleName: input.moduleName,
    provider: "apify",
    actionType: "scrape",
    modelOrActorId: actorId,
    unitCount: units,
    estimate: true
  });
  return { ...quote, minCredits: Math.max(quote.breakdown[0]?.credits || quote.credits, Math.ceil(quote.credits * 0.1)), maxCredits: quote.credits, label: `up to ${quote.credits.toLocaleString()} credits` };
}

function quotePersonaAutofill(db: Database, input: Record<string, unknown>): BillingQuote {
  const sourceCount = Math.max(1, Number(input.sourceCount || 1));
  const crawl = quoteScrape(db, {
    action: "persona.autofill_crawl",
    moduleName: "persona",
    actorId: String(input.actorId || "apify/google-search-scraper"),
    platform: "Google",
    maxResults: Math.max(10, sourceCount * 5)
  });
  const gpt = quoteText(
    db,
    "persona.autofill_gpt",
    "persona",
    String(input.model || "gpt-5-5"),
    Number(input.inputTokens || 2500),
    Number(input.outputTokens || 1200)
  );
  const credits = crawl.credits + gpt.credits;
  const minCredits = crawl.minCredits + gpt.minCredits;
  const maxCredits = crawl.maxCredits + gpt.maxCredits;
  const costUsd = roundUsd(crawl.costUsd + gpt.costUsd);
  const chargeUsd = roundUsd(credits / db.billingSettings.creditScale);
  return {
    action: "persona.autofill",
    module: "persona",
    provider: "custom",
    modelOrActorId: `${crawl.modelOrActorId}+${gpt.modelOrActorId}`,
    credits,
    minCredits,
    maxCredits,
    costUsd,
    chargeUsd,
    unit: "per_action",
    unitCount: 1,
    isEstimate: true,
    label: `up to ${maxCredits.toLocaleString()} credits`,
    rateCardId: `${crawl.rateCardId},${gpt.rateCardId}`,
    breakdown: [...crawl.breakdown, ...gpt.breakdown]
  };
}

function actorForPlatform(platform: string) {
  const normalized = platform.toLowerCase();
  if (normalized.includes("google") || normalized.includes("persona")) return "apify/google-search-scraper";
  if (normalized.includes("instagram")) return "apify/instagram-scraper";
  if (normalized.includes("tiktok")) return "clockworks/tiktok-scraper";
  if (normalized.includes("youtube")) return "streamers/youtube-scraper";
  if (normalized.includes("facebook")) return "scrapeforge/facebook-search-posts";
  return "apify/instagram-scraper";
}

function quoteSingleRate(db: Database, input: { action: string; moduleName: string; provider: BillingProvider; actionType: BillingRateCard["actionType"]; modelOrActorId: string; unitCount: number; estimate: boolean }): BillingQuote {
  const rateCard = findRate(db, input.provider, input.actionType, input.modelOrActorId);
  const line = quoteLine(db, rateCard, Math.max(1, input.unitCount || 1));
  return {
    action: input.action || `${input.moduleName}.${input.actionType}`,
    module: input.moduleName,
    provider: input.provider,
    modelOrActorId: rateCard.modelOrActorId,
    credits: line.credits,
    minCredits: line.credits,
    maxCredits: line.credits,
    costUsd: line.costUsd,
    chargeUsd: roundUsd(line.credits / db.billingSettings.creditScale),
    unit: rateCard.unit,
    unitCount: Math.max(1, input.unitCount || 1),
    isEstimate: input.estimate,
    label: line.credits === 0 ? "Included" : `${line.credits.toLocaleString()} credits${input.estimate ? " est." : ""}`,
    rateCardId: rateCard.id,
    breakdown: [{ label: rateCard.label, credits: line.credits, costUsd: line.costUsd, unit: rateCard.unit, unitCount: Math.max(1, input.unitCount || 1) }]
  };
}

function mapUiModel(db: Database, model: string) {
  return db.billingProviderMappings.find((mapping) => mapping.active && (mapping.uiKey === model || mapping.providerModelOrActorId === model))
    || defaultBillingProviderMappings.find((mapping) => mapping.uiKey === model)
    || defaultBillingProviderMappings.find((mapping) => mapping.uiKey === "gemini-3.5-flash")!;
}

function findRate(db: Database, provider: BillingProvider, actionType: BillingRateCard["actionType"], modelOrActorId: string) {
  const active = (db.billingRateCards || []).filter((card) => card.active && card.provider === provider && card.actionType === actionType);
  return active.find((card) => card.modelOrActorId === modelOrActorId)
    || active.find((card) => modelOrActorId.startsWith(card.modelOrActorId) || card.modelOrActorId.startsWith(modelOrActorId))
    || defaultBillingRateCards.find((card) => card.provider === provider && card.actionType === actionType && card.modelOrActorId === modelOrActorId)
    || (() => { throw new Error(`No billing rate configured for ${provider}:${actionType}:${modelOrActorId}.`); })();
}

function quoteLine(db: Database, rateCard: BillingRateCard, unitCount: number) {
  const costUsd = roundUsd(rateCard.baseCostUsd * unitCount);
  const credits = Math.max(rateCard.minimumChargeCredits, Math.ceil(costUsd * (rateCard.markupMultiplier || db.billingSettings.defaultMarkupMultiplier) * db.billingSettings.creditScale));
  return { costUsd, credits };
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function adminAdjustmentEntry(input: { workspaceId: string; userId?: string; credits: number; description: string; actorUserId: string; expiresAt?: string }): BillingLedgerEntry {
  const credits = Math.round(Number(input.credits || 0));
  return {
    id: createLedgerId(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: "admin_adjustment",
    module: "billing",
    provider: "local",
    action: "admin_adjustment",
    credits,
    usdCost: 0,
    markup: 0,
    status: "succeeded",
    description: input.description || (credits >= 0 ? "Admin credit grant" : "Admin credit removal"),
    metadata: { actorUserId: input.actorUserId },
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt || undefined
  };
}
