export type Platform = "TikTok" | "Instagram" | "LinkedIn" | "Facebook";

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
  cadence: "daily" | "weekly";
  lastScraped: string;
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
  caption: string;
  hashtags: string[];
  optimalTime: string;
  expectedPerformance: string;
  status: "new" | "approved" | "production" | "scheduled" | "published";
};

export type Asset = {
  id: string;
  workspaceId: string;
  briefId: string;
  title: string;
  type: "image" | "carousel" | "video" | "ugc";
  status: "queued" | "rendering" | "ready" | "failed";
  progress: number;
  createdAt: string;
  provider?: "local" | "kie";
  providerTaskId?: string;
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
  status: "draft" | "scheduled" | "published" | "failed";
  provider?: "local" | "upload-post";
  providerRequestId?: string;
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
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  activity: Activity[];
};
