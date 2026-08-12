export type Platform = "TikTok" | "Instagram" | "YouTube" | "LinkedIn" | "Facebook" | "X";

export type UserRole = "super_admin" | "admin" | "support_admin" | "owner" | "manager" | "creator" | "client" | "user";

export type PermissionKey =
  | "admin.access"
  | "users.view"
  | "users.create"
  | "users.edit"
  | "users.delete"
  | "users.disable"
  | "users.resetPassword"
  | "users.assignRole"
  | "permissions.view"
  | "permissions.manage"
  | "prompts.view"
  | "prompts.edit"
  | "apiKeys.view"
  | "apiKeys.edit"
  | "billing.view"
  | "billing.manage"
  | "finance.view"
  | "finance.reconcile"
  | "finance.export"
  | "finance.close"
  | "finance.resolveAlerts"
  | "stripe.view"
  | "stripe.connectTest"
  | "stripe.manageTestCatalogue"
  | "stripe.connectLive"
  | "stripe.manageLiveCatalogue"
  | "stripe.migrateSubscriptions"
  | "stripe.disconnect"
  | "stripe.viewEvents"
  | "stripe.approveLiveLaunch"
  | "stripe.manageLiveRollout"
  | "stripe.emergencyStop"
  | "system.view"
  | "logs.view"
  | "settings.view"
  | "settings.edit";

export type RolePermissions = Record<UserRole, PermissionKey[]>;

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  workspaceId: string;
  stripeCustomerId?: string;
  stripeCustomerIds?: Partial<Record<StripeMode, string>>;
  emailVerified?: boolean;
  emailVerificationCodeHash?: string;
  emailVerificationExpiresAt?: string;
  disabledAt?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
};

export type Workspace = {
  id: string;
  name: string;
  niche: string;
  plan: "Starter" | "Pro" | "Agency";
  credits: number;
  setup: number;
};

export type BrandKit = {
  workspaceId: string;
  primary: string;
  secondary: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
  voice: string;
  watermark: boolean;
};

export type PersonaProfile = {
  workspaceId: string;
  displayName: string;
  role: string;
  company: string;
  companyOneLiner: string;
  primaryAudience: string;
  audienceInsight: string;
  contentLanguage: string;
  voiceStyle: string;
  naturalPhrases: string[];
  bannedVocabulary: string[];
  approvedTopics: string[];
  offLimitsTopics: string[];
  strongOpinions: string;
  writingSamples: string[];
  sourceUrls: {
    linkedin: string;
    website: string;
    instagram: string;
    facebook: string;
    x: string;
  };
  mediaAssets: PersonaMediaAsset[];
  updatedAt?: string;
};

export type PersonaMediaAsset = {
  id: string;
  role: "product photo" | "avatar/persona" | "logo" | "audio";
  label: string;
  fileName: string;
  url: string;
  storageKey?: string;
  contentType?: string;
  createdAt: string;
};

export type Competitor = {
  id: string;
  workspaceId: string;
  platform: Platform;
  handle: string;
  url?: string;
  minViews?: number;
  cadence: "daily" | "weekly";
  lastScraped: string;
};

export type CompetitorResult = {
  id: string;
  workspaceId: string;
  competitorId: string;
  platform: Platform;
  url: string;
  title: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  mediaType?: "video" | "image" | "unknown";
  duration?: number;
  description?: string;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string;
  capturedAt: string;
};

export type ResearchScan = {
  id: string;
  workspaceId: string;
  url: string;
  query?: string;
  dimensions?: {
    actorSources?: string[];
    contentTypes?: string[];
    formats?: string[];
    contentType?: string;
    uploadDate?: string;
    sourceOwnershipFilter?: string;
  };
  platform: Platform;
  minViews: number;
  resultIds: string[];
  createdAt: string;
  completedAt?: string;
  status?: "running" | "done" | "failed";
  source: "apify" | "cache" | "fallback";
  apifyRunId?: string;
  apifyDatasetId?: string;
  apifyActorId?: string;
  billingReservationId?: string;
  billingSettledAt?: string;
  error?: string;
};

export type SocialAudit = {
  id: string;
  workspaceId: string;
  url: string;
  platform: Platform;
  handle: string;
  authorityScore: number;
  avgViews: number;
  avgLikes: number;
  postsAnalysed: number;
  topResultIds: string[];
  createdAt: string;
  source: "apify" | "fallback";
  error?: string;
};

export type Opportunity = {
  id: string;
  workspaceId: string;
  topic: string;
  platform: Platform;
  format: string;
  gapScore: number;
  trendVelocity: number;
  competitorGap: number;
  nicheRelevance: number;
  engagementPotential: number;
  platformFit: number;
  status: "new" | "briefed" | "dismissed";
};

export type Brief = {
  id: string;
  workspaceId: string;
  opportunityId?: string;
  topic: string;
  format: string;
  platforms: Platform[];
  hooks: string[];
  outline: string[];
  description?: string;
  videoPrompt?: string;
  duration?: number;
  shotList?: string[];
  creativeNotes?: string;
  sourceResultId?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourcePlatform?: Platform;
  sourceThumbnailUrl?: string;
  sourceMediaUrl?: string;
  sourceMediaType?: "video" | "image" | "unknown";
  caption: string;
  hashtags: string[];
  optimalTime: string;
  expectedPerformance: string;
  analysisSummary?: string;
  createdAt?: string;
  updatedAt?: string;
  status: "new" | "approved" | "production" | "scheduled" | "published";
};

export type Asset = {
  id: string;
  workspaceId: string;
  briefId: string;
  title: string;
  type: "image" | "carousel" | "video" | "ugc" | "text";
  status: "queued" | "rendering" | "ready" | "failed";
  progress: number;
  createdAt: string;
  provider?: "local" | "kie";
  providerTaskId?: string;
  generationModel?: string;
  generationSettings?: Record<string, unknown>;
  assetUrl?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceThumbnailUrl?: string;
  sourceMediaUrl?: string;
  sourceMediaType?: "video" | "image" | "unknown";
  prompt?: string;
  assetReferences?: GenerationAssetReference[];
  error?: string;
};

export type PublishItem = {
  id: string;
  workspaceId: string;
  assetId: string;
  title: string;
  platform: Platform;
  scheduledAt: string;
  status: "draft" | "generating" | "done" | "scheduled" | "published" | "failed";
  provider?: "local" | "kie" | "upload-post";
  providerRequestId?: string;
  caption?: string;
  hashtags?: string[];
  generationModel?: string;
  generationType?: "video" | "image" | "text";
  generationSettings?: Record<string, unknown>;
  duration?: number;
  prompt?: string;
  assetUrl?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceThumbnailUrl?: string;
  sourceMediaUrl?: string;
  sourceMediaType?: "video" | "image" | "unknown";
  assetReferences?: GenerationAssetReference[];
  createdAt?: string;
  error?: string;
};

export type AutomationRule = {
  id: string;
  workspaceId: string;
  name: string;
  instruction: string;
  goal: "leads" | "awareness" | "engagement" | "authority" | "sales";
  platforms: Platform[];
  contentType: "image" | "short-video" | "long-video" | "text";
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
  model: string;
  frequency: "daily" | "weekly" | "custom";
  postingDays: string[];
  postingTime: string;
  timezone: string;
  quantityPerRun: number;
  approvalMode: "draft-only" | "generate-and-wait" | "auto-schedule" | "auto-publish";
  researchMode: "latest-research" | "keywords" | "none";
  keywords: string[];
  sourceUrls: string[];
  restrictions: string;
  duplicateProtection: {
    mode: "off" | "light" | "standard" | "strict";
    sourceWindowDays: number;
    topicWindowDays: number;
    similarityThreshold: number;
    maxRetries: number;
  };
  referenceAssets?: GenerationAssetReference[];
  maxCreditsPerRun?: number;
  monthlyCreditCap?: number;
  lowBalanceAutoPause?: boolean;
  status: "active" | "paused" | "failed";
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
  lastSkippedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationJob = {
  id: string;
  workspaceId: string;
  automationRuleId: string;
  scheduledFor: string;
  status: "pending" | "checking-duplicates" | "ready-for-generation" | "skipped-duplicate" | "failed";
  title: string;
  prompt: string;
  caption: string;
  hashtags: string[];
  duplicateCheck: {
    mode: AutomationRule["duplicateProtection"]["mode"];
    checkedAt: string;
    matchedItemId?: string;
    matchedTitle?: string;
    similarityScore: number;
    reason: string;
    attempts: number;
  };
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type AutomationSourceWatcher = {
  id: string;
  workspaceId: string;
  name: string;
  sourceUrls: string[];
  instruction: string;
  contentType: "auto" | "video" | "image" | "text";
  model: string;
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
  duration?: number;
  minViews: number;
  rankingMode: "balanced" | "views" | "engagement" | "recent";
  frequency: "daily" | "weekly" | "custom";
  postingDays: string[];
  postingTime: string;
  timezone: string;
  approvalMode: "draft-only" | "generate-and-wait" | "auto-schedule" | "auto-publish";
  referenceUrls: {
    logo?: string;
    productPhoto?: string;
    avatar?: string;
    audio?: string;
  };
  referenceAssets?: GenerationAssetReference[];
  duplicateProtection: {
    sourceWindowDays: number;
    topicWindowDays: number;
    similarityThreshold: number;
  };
  maxCreditsPerRun?: number;
  monthlyCreditCap?: number;
  lowBalanceAutoPause?: boolean;
  status: "active" | "paused" | "failed";
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
  lastSkippedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationSourceRun = {
  id: string;
  workspaceId: string;
  watcherId: string;
  status: "running" | "completed" | "no-match" | "failed" | "skipped";
  sourceUrls: string[];
  scannedCount: number;
  selectedResultId?: string;
  selectedTitle?: string;
  selectedUrl?: string;
  selectedScore?: number;
  selectionReason?: string;
  publishItemId?: string;
  assetId?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  billingSkippedReason?: string;
  billingRunCapCredits?: number;
  billingMonthlyCapCredits?: number;
  billingBalanceAtRun?: number;
  billingEstimatedCredits?: number;
};

export type StripeMode = "test" | "live";

export type ApiKeyProvider =
  | "kie"
  | "apify"
  | "apifyBackup"
  | "uploadPost"
  | "stripePublishable"
  | "stripeSecret"
  | "stripeWebhook"
  | "stripePortal"
  | "stripeTestPublishable"
  | "stripeTestSecret"
  | "stripeTestWebhook"
  | "stripeTestPortal"
  | "stripeLivePublishable"
  | "stripeLiveSecret"
  | "stripeLiveWebhook"
  | "stripeLivePortal";

export type ApiKeyOverride = {
  provider: ApiKeyProvider;
  encryptedValue: string;
  updatedAt: string;
  updatedBy: string;
};

export type GenerationAssetReference = {
  role: string;
  fileName: string;
  url?: string;
  storageKey?: string;
  contentType?: string;
};

export type Activity = {
  id: string;
  workspaceId: string;
  message: string;
  createdAt: string;
};

export type DebugLog = {
  id: string;
  workspaceId: string;
  action: string;
  label: string;
  status: "started" | "success" | "failed" | "info";
  provider?: "apify" | "kie" | "upload-post" | "local" | "system";
  prompt?: string;
  details?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type BillingProvider = "kie" | "apify" | "upload-post" | "brevo" | "stripe" | "local" | "custom";

export type BillingLedgerType =
  | "purchase"
  | "subscription_grant"
  | "usage"
  | "reserve"
  | "release"
  | "refund"
  | "admin_adjustment"
  | "bonus";

export type BillingLedgerStatus = "pending" | "succeeded" | "failed" | "refunded" | "reserved" | "released";

export type BillingRateUnit = "per_action" | "per_second" | "per_image" | "per_1k_tokens" | "per_1k_results" | "per_post";

export type BillingRateCard = {
  id: string;
  provider: BillingProvider;
  actionType: "video_generation" | "image_generation" | "text_generation" | "scrape" | "persona_crawl" | "publish" | "automation_run" | "ai_assist";
  modelOrActorId: string;
  label: string;
  unit: BillingRateUnit;
  baseCostUsd: number;
  markupMultiplier: number;
  minimumChargeCredits: number;
  roundingMode: "ceil";
  active: boolean;
  source: "manual" | "provider_sync";
  lastSyncedAt?: string;
  metadata?: Record<string, unknown>;
};

export type BillingPricingAlertStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "manual_required"
  | "kept_manual";

export type BillingPricingSyncRun = {
  id: string;
  provider: BillingProvider;
  status: "completed" | "failed";
  scannedCount: number;
  alertCount: number;
  manualRequiredCount: number;
  startedAt: string;
  completedAt: string;
  error?: string;
  createdBy?: string;
};

export type BillingPricingAlert = {
  id: string;
  runId: string;
  provider: BillingProvider;
  rateCardId: string;
  label: string;
  modelOrActorId: string;
  oldBaseCostUsd: number;
  newBaseCostUsd?: number;
  oldUnit: BillingRateUnit;
  newUnit?: BillingRateUnit;
  changePercent?: number;
  status: BillingPricingAlertStatus;
  source: "kie_pricing_page" | "apify_actor_metadata" | "manual_catalog" | "manual_required";
  reason: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  appliedAt?: string;
};

export type BillingProviderMapping = {
  id: string;
  uiKey: string;
  provider: BillingProvider;
  providerModelOrActorId: string;
  actionType: BillingRateCard["actionType"];
  label: string;
  active: boolean;
  metadata?: Record<string, unknown>;
};

export type BillingPlan = {
  id: string;
  name: string;
  priceUsd: number;
  baseCredits: number;
  bonusPercent: number;
  totalCredits: number;
  expiryDays: number;
  stripePriceId?: string;
  active: boolean;
  monthlyUsageLimitCredits?: number;
  automationAllowed?: boolean;
  maxConcurrentGenerations?: number;
};

export type BillingStripeConnection = {
  mode: StripeMode;
  status: "disconnected" | "connected" | "error";
  accountId?: string;
  accountName?: string;
  country?: string;
  defaultCurrency?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  webhookEndpointId?: string;
  webhookUrl?: string;
  webhookStatus?: "missing" | "configured" | "error";
  checkoutEnabled: boolean;
  lastValidatedAt?: string;
  lastWebhookAt?: string;
  catalogSyncedAt?: string;
  error?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type BillingStripeCatalogueMapping = {
  id: string;
  mode: StripeMode;
  itemKind: "plan" | "package";
  itemId: string;
  productId: string;
  priceId: string;
  revisionId: string;
  amountUsd: number;
  currency: "usd";
  interval?: "month";
  active: boolean;
  status: "synced" | "out_of_sync" | "archived" | "error";
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type BillingStripeCatalogueRevision = {
  id: string;
  mode: StripeMode;
  itemKind: "plan" | "package";
  itemId: string;
  itemName: string;
  productId: string;
  priceId: string;
  amountUsd: number;
  currency: "usd";
  interval?: "month";
  baseCredits: number;
  bonusCredits: number;
  bonusPercent: number;
  totalCredits: number;
  expiryDays?: number;
  effectiveAt: string;
  retiredAt?: string;
  createdBy: string;
  reason: string;
};

export type BillingCheckoutOrder = {
  id: string;
  mode: StripeMode;
  userId: string;
  workspaceId: string;
  itemKind: "plan" | "package";
  itemId: string;
  itemName: string;
  catalogueRevisionId: string;
  stripePriceId: string;
  amountUsd: number;
  currency: "usd";
  creditsPromised: number;
  expiryDays?: number;
  status: "pending" | "checkout_created" | "paid" | "failed" | "expired" | "refunded";
  stripeCheckoutSessionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
};

export type BillingStripeSubscriptionMigration = {
  id: string;
  mode: StripeMode;
  planId: string;
  fromRevisionId?: string;
  toRevisionId: string;
  policy: "new_customers_only" | "next_renewal" | "change_now";
  prorationBehavior?: "create_prorations" | "none";
  affectedSubscriptions: number;
  status: "recorded" | "pending" | "completed" | "partially_failed" | "failed";
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  results?: { subscriptionId: string; status: "pending" | "completed" | "failed"; error?: string }[];
};

export type StripeLiveRolloutStage = "disabled" | "owner_only" | "internal" | "allowlist" | "all_verified";

export type BillingStripeReadinessItem = {
  key: string;
  label: string;
  description: string;
  confirmed: boolean;
  note?: string;
  confirmedAt?: string;
  confirmedBy?: string;
};

export type BillingStripeLaunchControl = {
  readiness: BillingStripeReadinessItem[];
  readinessApprovedAt?: string;
  readinessApprovedBy?: string;
  liveCatalogueFingerprint?: string;
  liveCatalogueApprovedAt?: string;
  liveCatalogueApprovedBy?: string;
  rolloutStage: StripeLiveRolloutStage;
  allowlistedUserIds: string[];
  checkoutKillSwitch: boolean;
  emergencyStoppedAt?: string;
  emergencyStoppedBy?: string;
  emergencyReason?: string;
  lastPreflightAt?: string;
  lastPreflightPassed?: boolean;
  lastPreflightChecks?: { key: string; label: string; passed: boolean; detail: string }[];
  updatedAt?: string;
  updatedBy?: string;
};

export type BillingStripeLaunchReport = {
  id: string;
  status: "draft" | "approved";
  topUpOrderId?: string;
  subscriptionOrderId?: string;
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
  ledgerEntryIds: string[];
  checks: {
    topUpCreditsCorrect: boolean;
    subscriptionCreditsCorrect: boolean;
    receiptConfirmed: boolean;
    portalConfirmed: boolean;
    cancellationConfirmed: boolean;
    refundConfirmed: boolean;
    duplicateWebhookConfirmed: boolean;
  };
  notes?: string;
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
};

export type BillingCreditPackage = {
  id: string;
  name: string;
  priceUsd: number;
  baseCredits: number;
  bonusPercent: number;
  bonusCredits: number;
  totalCredits: number;
  stripePriceId?: string;
  active: boolean;
  expiresAfterDays?: number;
  maxPurchasesPerMonth?: number;
};

export type BillingSettings = {
  creditScale: number;
  defaultMarkupMultiplier: number;
  currency: "USD";
  lowCreditThreshold: number;
  automationMinimumBalance: number;
  automationDefaultRunCap: number;
  automationDefaultMonthlyCap: number;
  dailySpendLimitCredits?: number;
  monthlySpendLimitCredits?: number;
  maxConcurrentGenerations?: number;
  failedGenerationRefundPolicy?: "release_only" | "refund_if_provider_failed" | "manual_review";
  stripeMode?: "test" | "live";
  stripeCheckoutEnabled?: Partial<Record<StripeMode, boolean>>;
  financeMarginAlertPercent?: number;
  financeLiabilityAlertUsd?: number;
  financeHighSpendUserUsd?: number;
  financeWebhookFailureHours?: number;
  allowNegativeBalance: false;
};

export type BillingStripeBalanceTransaction = {
  id: string;
  stripeBalanceTransactionId: string;
  mode: StripeMode;
  amountUsd: number;
  feeUsd: number;
  netUsd: number;
  currency: string;
  settlementCurrency: string;
  settlementAmount: number;
  settlementFee: number;
  settlementNet: number;
  exchangeRate?: number;
  sourceCurrency?: string;
  type: string;
  reportingCategory: string;
  status: string;
  sourceId?: string;
  chargeId?: string;
  paymentIntentId?: string;
  refundId?: string;
  payoutId?: string;
  description?: string;
  createdAt: string;
  availableOn?: string;
  syncedAt: string;
};

export type BillingReconciliationRun = {
  id: string;
  mode: StripeMode;
  source: "manual" | "scheduled";
  status: "completed" | "failed";
  from: string;
  to: string;
  syncedTransactions: number;
  checkedRecords: number;
  alertsDetected: number;
  startedAt: string;
  completedAt: string;
  initiatedBy?: string;
  error?: string;
};

export type BillingReconciliationAlert = {
  id: string;
  mode: StripeMode;
  type: "payment_without_credits" | "credits_without_payment" | "amount_mismatch" | "currency_mismatch" | "duplicate_credit" | "refund_without_reversal" | "subscription_mismatch" | "webhook_failure" | "negative_balance" | "margin_threshold" | "liability_threshold" | "high_user_spend";
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved" | "ignored";
  message: string;
  amountUsd?: number;
  orderId?: string;
  ledgerEntryId?: string;
  userId?: string;
  workspaceId?: string;
  stripeReference?: string;
  details?: Record<string, unknown>;
  detectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
};

export type BillingFinanceMetrics = {
  grossSalesUsd: number;
  refundsUsd: number;
  netSalesUsd: number;
  stripeFeesUsd: number;
  netCashUsd: number;
  subscriptionRevenueUsd: number;
  topUpRevenueUsd: number;
  providerCostUsd: number;
  grossMarginUsd: number;
  grossMarginPercent: number;
  creditsSold: number;
  creditsGranted: number;
  creditsConsumed: number;
  creditsExpired: number;
  creditsRefunded: number;
  creditsAdjusted: number;
  faceValueLiabilityUsd: number;
  providerCostLiabilityUsd: number;
  mrrUsd: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  canceledSubscriptions: number;
  churnRatePercent: number;
};

export type BillingFinanceCloseReport = {
  id: string;
  periodType: "daily" | "monthly";
  mode: StripeMode;
  from: string;
  to: string;
  metrics: BillingFinanceMetrics;
  unresolvedAlertCount: number;
  unresolvedAlertValueUsd: number;
  transactionCount: number;
  ledgerEntryCount: number;
  hash: string;
  createdAt: string;
  createdBy: string;
};

export type BillingLedgerEntry = {
  id: string;
  userId?: string;
  workspaceId: string;
  type: BillingLedgerType;
  module: string;
  provider: BillingProvider;
  action: string;
  credits: number;
  usdCost: number;
  markup: number;
  status: BillingLedgerStatus;
  relatedId?: string;
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
  providerTaskId?: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
};

export type BillingSubscriptionState = {
  id: string;
  workspaceId: string;
  userId: string;
  planId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeMode?: StripeMode;
  catalogueRevisionId?: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused" | "unknown";
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  latestInvoiceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type BillingStripeEvent = {
  id: string;
  stripeEventId: string;
  type: string;
  livemode: boolean;
  status: "processed" | "ignored" | "failed";
  error?: string;
  createdAt: string;
  processedAt: string;
  metadata?: Record<string, unknown>;
};

export type BillingQuote = {
  action: string;
  module: string;
  provider: BillingProvider;
  modelOrActorId: string;
  credits: number;
  minCredits: number;
  maxCredits: number;
  costUsd: number;
  chargeUsd: number;
  unit: BillingRateUnit;
  unitCount: number;
  isEstimate: boolean;
  label: string;
  rateCardId: string;
  breakdown: {
    label: string;
    credits: number;
    costUsd: number;
    unit: BillingRateUnit;
    unitCount: number;
  }[];
};

export type PromptTemplates = {
  researchVideoRecreate: string;
  researchImageRecreate: string;
  researchVideoPromptRefine: string;
  researchTextRecreate: string;
  videoGenerationGuardrails: string;
  ugcStoryboard: string;
  ugcSceneGeneration: string;
};

export type UgcVideoScene = {
  id: string;
  order: number;
  title: string;
  prompt: string;
  duration: number;
  dialogue?: string;
  // Legacy scene-job fields remain readable for projects created before single_video_v2.
  status?: "draft" | "waiting" | "queued" | "generating" | "completed" | "cancelled" | "failed";
  progress?: number;
  providerTaskId?: string;
  providerUrl?: string;
  storageKey?: string;
  outputUrl?: string;
  error?: string;
  retryCount?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type UgcVideoProjectStatus = "draft" | "storyboard_ready" | "awaiting_confirmation" | "queued" | "generating" | "completed" | "cancelled" | "failed" | "legacy_scene_jobs";

export type UgcVideoGenerationAttempt = {
  id: string;
  attemptNumber: number;
  promptSnapshot: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  taskId: string;
  status: "waiting" | "queued" | "generating" | "completed" | "cancelled" | "failed";
  progress: number;
  providerResultUrl?: string;
  outputStorageKey?: string;
  outputUrl?: string;
  error?: string;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  createdAt: string;
  completedAt?: string;
};

export type UgcVideoProject = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  productName: string;
  sellingPoints: string;
  audience: string;
  style: string;
  language: string;
  workflowVersion: "single_video_v2" | "legacy_scene_jobs";
  targetDuration: 15;
  sourceImageUrl: string;
  sourceImageStorageKey?: string;
  concept?: string;
  caption?: string;
  hashtags?: string[];
  model: "seedance-2.0";
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p";
  status: UgcVideoProjectStatus;
  scenes: UgcVideoScene[];
  estimatedStoryboardCostUsd: number;
  estimatedVideoCostUsd: number;
  estimatedTotalCostUsd: number;
  actualCostUsd?: number;
  costRateSnapshot?: Record<string, number>;
  combinedPrompt?: string;
  providerTaskId?: string;
  providerStatus?: "waiting" | "queued" | "generating" | "completed" | "cancelled" | "failed";
  providerProgress?: number;
  providerError?: string;
  providerResultUrl?: string;
  generationIdempotencyKey?: string;
  generationAttempt: number;
  generationAttempts: UgcVideoGenerationAttempt[];
  finalVideoStorageKey?: string;
  finalVideoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type Database = {
  users: User[];
  workspaces: Workspace[];
  brandKits: BrandKit[];
  personaProfiles: PersonaProfile[];
  competitors: Competitor[];
  competitorResults: CompetitorResult[];
  researchScans: ResearchScan[];
  socialAudits: SocialAudit[];
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  automationRules: AutomationRule[];
  automationJobs: AutomationJob[];
  automationSourceWatchers: AutomationSourceWatcher[];
  automationSourceRuns: AutomationSourceRun[];
  apiKeyOverrides: ApiKeyOverride[];
  activity: Activity[];
  debugLogs: DebugLog[];
  billingSettings: BillingSettings;
  billingRateCards: BillingRateCard[];
  billingProviderMappings: BillingProviderMapping[];
  billingPlans: BillingPlan[];
  billingCreditPackages: BillingCreditPackage[];
  billingLedger: BillingLedgerEntry[];
  billingPricingSyncRuns: BillingPricingSyncRun[];
  billingPricingAlerts: BillingPricingAlert[];
  billingSubscriptions: BillingSubscriptionState[];
  billingStripeEvents: BillingStripeEvent[];
  billingStripeConnections: BillingStripeConnection[];
  billingStripeCatalogueMappings: BillingStripeCatalogueMapping[];
  billingStripeCatalogueRevisions: BillingStripeCatalogueRevision[];
  billingCheckoutOrders: BillingCheckoutOrder[];
  billingStripeSubscriptionMigrations: BillingStripeSubscriptionMigration[];
  billingStripeLaunchControl: BillingStripeLaunchControl;
  billingStripeLaunchReports: BillingStripeLaunchReport[];
  billingStripeBalanceTransactions: BillingStripeBalanceTransaction[];
  billingReconciliationRuns: BillingReconciliationRun[];
  billingReconciliationAlerts: BillingReconciliationAlert[];
  billingFinanceCloseReports: BillingFinanceCloseReport[];
  promptTemplates: PromptTemplates;
  ugcVideoProjects: UgcVideoProject[];
  rolePermissions: RolePermissions;
};
