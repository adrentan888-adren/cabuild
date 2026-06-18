export type Platform = "TikTok" | "Instagram" | "YouTube" | "LinkedIn" | "Facebook" | "X";

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "owner" | "manager" | "creator" | "client";
  workspaceId: string;
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
    uploadDate?: string;
  };
  platform: Platform;
  minViews: number;
  resultIds: string[];
  createdAt: string;
  source: "apify" | "cache" | "fallback";
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
  assetUrl?: string;
  prompt?: string;
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
  duration?: number;
  prompt?: string;
  assetUrl?: string;
  createdAt?: string;
  error?: string;
};

export type Activity = {
  id: string;
  workspaceId: string;
  message: string;
  createdAt: string;
};

export type Database = {
  users: User[];
  workspaces: Workspace[];
  brandKits: BrandKit[];
  competitors: Competitor[];
  competitorResults: CompetitorResult[];
  researchScans: ResearchScan[];
  socialAudits: SocialAudit[];
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  activity: Activity[];
};
