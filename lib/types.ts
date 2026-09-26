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
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedAt?: string;
  publishingStartedAt?: string;
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
  duration?: number;
  runningUntil?: string;
  frequency: "daily" | "weekly" | "custom" | "interval";
  postingDays: string[];
  postingTime: string;
  postingTimes?: string[];
  intervalDays?: number;
  scheduleStartDate?: string;
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
  status: "active" | "paused" | "failed";
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
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
  assetId?: string;
  publishItemIds?: string[];
  ruleSnapshot?: AutomationRule;
  briefPrepared?: boolean;
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
  runningUntil?: string;
  minViews: number;
  rankingMode: "balanced" | "views" | "engagement" | "recent";
  frequency: "daily" | "weekly" | "custom" | "interval";
  postingDays: string[];
  postingTime: string;
  postingTimes?: string[];
  intervalDays?: number;
  scheduleStartDate?: string;
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
  status: "active" | "paused" | "failed";
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationSourceRun = {
  id: string;
  workspaceId: string;
  watcherId: string;
  status: "running" | "completed" | "no-match" | "failed";
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
};

export type ApiKeyProvider = "kie" | "apify" | "apifyBackup" | "uploadPost";

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

export type PromptTemplates = {
  researchVideoRecreate: string;
  researchImageRecreate: string;
  researchVideoPromptRefine: string;
  researchTextRecreate: string;
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
  promptTemplates: PromptTemplates;
  rolePermissions: RolePermissions;
};
