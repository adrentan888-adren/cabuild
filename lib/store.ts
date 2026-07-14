import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { defaultBillingCreditPackages, defaultBillingPlans, defaultBillingProviderMappings, defaultBillingRateCards, defaultBillingSettings, ensureBillingDefaults } from "./billing";
import { normalizePersonaProfile } from "./persona";
import { mutatePostgresDb, postgresEnabled, readPostgresDb, writePostgresDb } from "./postgresStore";
import type { Database, PermissionKey, PersonaProfile, Platform, PromptTemplates, RolePermissions, UserRole } from "./types";

const dataDir = path.join(process.cwd(), "data");
const dataFile = process.env.DATA_STORE_LOCAL_FILE ? path.resolve(process.env.DATA_STORE_LOCAL_FILE) : path.join(dataDir, "app.json");
const localDataDir = path.dirname(dataFile);
const gcsBucket = process.env.DATA_STORE_GCS_BUCKET;
const gcsObject = process.env.DATA_STORE_GCS_OBJECT || "app.json";

export function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  if (typeof stored !== "string") return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return hashPassword(password, salt).split(":")[1] === hash;
}

export function defaultPersonaProfile(workspaceId: string): PersonaProfile {
  return normalizePersonaProfile(workspaceId);
}

export const defaultPromptTemplates: PromptTemplates = {
  researchVideoRecreate: "Please analyse the attached video and write the prompt to recreate this video in JSON format in very detailed terms, no more than 3000 characters. Source video: {{sourceMediaUrl}}. Source page/post: {{sourceUrl}}. Source title: {{sourceTitle}}. {{durationLine}} {{assetInstruction}}\n\n{{personaContext}}",
  researchImageRecreate: "Please analyse the attached image/graphic and write the prompt to recreate this image in JSON format in very detailed terms, no more than 3000 characters. Source image: {{sourceMediaUrl}}. Source page/post: {{sourceUrl}}. Source title: {{sourceTitle}}. {{assetInstruction}}\n\n{{personaContext}}",
  researchTextRecreate: "Analyze this source post and write a new high-conversion text post in the same strategic style without copying it. Source: {{sourceUrl}}. Source title: {{sourceTitle}}. Source description: {{sourceDescription}}. Keep the final post original, platform-native, and ready for social publishing.\n\n{{personaContext}}",
  researchVideoPromptRefine: `You are ContentAgent's senior video prompt engineer.

Convert the user's research recreation instruction into ONE final provider-ready video generation prompt.

Rules:
- Return ONLY valid JSON with this shape: {"videoPrompt":"..."}
- The videoPrompt must be no more than 3000 characters.
- Preserve the selected duration requirement exactly if present, for example: "the video duration is supposed to be 8s".
- Keep any source video/page context that helps recreate the structure, pacing, camera, hook, and conversion angle.
- If user-uploaded references are mentioned, use only those attached assets for logo/person/audio replacement.
- If a logo reference is attached, explicitly instruct the provider to use that exact uploaded logo and not a placeholder, invented wordmark, or original source logo.
- If an avatar/person reference is attached, explicitly instruct the provider to replace the original person/creator with the uploaded persona reference.
- If an audio reference is attached, explicitly instruct the provider to replace/change the original audio using that user-approved audio direction when supported.
- If no matching user attachment is provided, instruct the model to remove the original logo, change the person, and change or replace the audio.
- Optimize for high-conversion social media output: strong 0-3 second hook, clear USP, platform-native pacing, readable mobile framing, CTA, and compliance-safe wording.
- Do not copy protected identity, exact creator likeness, original brand/logo, or original audio unless the user explicitly provided replacement references.

User instruction to transform:
{{prompt}}`
};

export const allRoles: UserRole[] = ["super_admin", "admin", "support_admin", "owner", "manager", "creator", "client", "user"];

const allPermissionKeys: PermissionKey[] = [
  "admin.access",
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "users.disable",
  "users.resetPassword",
  "users.assignRole",
  "permissions.view",
  "permissions.manage",
  "prompts.view",
  "prompts.edit",
  "apiKeys.view",
  "apiKeys.edit",
  "billing.view",
  "billing.manage",
  "stripe.view",
  "stripe.connectTest",
  "stripe.manageTestCatalogue",
  "stripe.connectLive",
  "stripe.manageLiveCatalogue",
  "stripe.migrateSubscriptions",
  "stripe.disconnect",
  "stripe.viewEvents",
  "system.view",
  "logs.view",
  "settings.view",
  "settings.edit"
];

export const defaultRolePermissions: RolePermissions = {
  super_admin: allPermissionKeys,
  owner: allPermissionKeys,
  admin: [
    "admin.access",
    "users.view",
    "users.create",
    "users.edit",
    "users.disable",
    "users.resetPassword",
    "users.assignRole",
    "permissions.view",
    "prompts.view",
    "prompts.edit",
    "apiKeys.view",
    "apiKeys.edit",
    "billing.view",
    "billing.manage",
    "stripe.view",
    "stripe.connectTest",
    "stripe.manageTestCatalogue",
    "stripe.viewEvents",
    "system.view",
    "logs.view",
    "settings.view",
    "settings.edit"
  ],
  support_admin: [
    "admin.access",
    "users.view",
    "permissions.view",
    "prompts.view",
    "apiKeys.view",
    "billing.view",
    "stripe.view",
    "stripe.viewEvents",
    "system.view",
    "logs.view",
    "settings.view"
  ],
  manager: ["settings.view", "logs.view"],
  creator: [],
  client: [],
  user: []
};

export function seeded(): Database {
  const workspaceId = "ws_demo";
  const userId = "usr_demo";
  const platforms: Platform[] = ["TikTok", "Instagram", "LinkedIn", "Facebook"];
  const db: Database = {
    users: [
      {
        id: userId,
        email: "demo@contentagent.tech",
        name: "Sean Tan",
        passwordHash: hashPassword("demo1234"),
        role: "owner",
        workspaceId,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    workspaces: [{ id: workspaceId, name: "ContentAgent Social", niche: "SME AI automation", plan: "Pro", credits: 240, setup: 62 }],
    brandKits: [
      {
        workspaceId,
        primary: "#1a1a1a",
        secondary: "#f5f4ee",
        accent: "#378add",
        headingFont: "Inter",
        bodyFont: "System",
        voice: "Practical, direct, founder-led, opinionated without hype.",
        watermark: true
      }
    ],
    personaProfiles: [defaultPersonaProfile(workspaceId)],
    competitors: [
      { id: id("cmp"), workspaceId, platform: "TikTok", handle: "@aioperator", cadence: "daily", lastScraped: new Date().toISOString() },
      { id: id("cmp"), workspaceId, platform: "LinkedIn", handle: "GrowthOps AI", cadence: "weekly", lastScraped: new Date().toISOString() }
    ],
    competitorResults: [
      {
        id: id("res"),
        workspaceId,
        competitorId: "seed",
        platform: "TikTok",
        url: "https://www.tiktok.com/@aioperator/video/demo",
        title: "I automated my invoice chasing in one afternoon",
        thumbnailUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=480&h=270&fit=crop",
        description: "Competitor post about automating collections and admin follow-up.",
        views: 128400,
        likes: 9200,
        comments: 410,
        publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 21).toISOString(),
        capturedAt: new Date().toISOString()
      },
      {
        id: id("res"),
        workspaceId,
        competitorId: "seed",
        platform: "Instagram",
        url: "https://www.instagram.com/reel/demo",
        title: "3 reports your team should stop doing manually",
        thumbnailUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=480&h=270&fit=crop",
        description: "A carousel-style breakdown of recurring manual reports.",
        views: 48200,
        likes: 3100,
        comments: 126,
        publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 42).toISOString(),
        capturedAt: new Date().toISOString()
      }
    ],
    researchScans: [],
    socialAudits: [],
    opportunities: [
      {
        id: "opp_automation",
        workspaceId,
        topic: "Why SMEs are replacing repetitive ops tasks with AI agents",
        platform: "TikTok",
        format: "Short video 9:16",
        gapScore: 87,
        trendVelocity: 18,
        competitorGap: 17,
        nicheRelevance: 19,
        engagementPotential: 16,
        platformFit: 17,
        status: "new"
      },
      {
        id: "opp_linkedin",
        workspaceId,
        topic: "The hidden cost of manual reporting in founder-led teams",
        platform: "LinkedIn",
        format: "Text post",
        gapScore: 78,
        trendVelocity: 14,
        competitorGap: 18,
        nicheRelevance: 17,
        engagementPotential: 15,
        platformFit: 14,
        status: "new"
      }
    ],
    briefs: [],
    assets: [],
    publishQueue: [],
    automationRules: [],
    automationJobs: [],
    automationSourceWatchers: [],
    automationSourceRuns: [],
    apiKeyOverrides: [],
    activity: [
      { id: id("act"), workspaceId, message: "Detected TikTok automation topic crossing high-priority threshold.", createdAt: new Date().toISOString() }
    ],
    debugLogs: [],
    billingSettings: { ...defaultBillingSettings },
    billingRateCards: defaultBillingRateCards.map((item) => ({ ...item })),
    billingProviderMappings: defaultBillingProviderMappings.map((item) => ({ ...item })),
    billingPlans: defaultBillingPlans.map((item) => ({ ...item })),
    billingCreditPackages: defaultBillingCreditPackages.map((item) => ({ ...item })),
    billingLedger: [],
    billingPricingSyncRuns: [],
    billingPricingAlerts: [],
    billingSubscriptions: [],
    billingStripeEvents: [],
    billingStripeConnections: [
      { mode: "test", status: "disconnected", checkoutEnabled: false, webhookStatus: "missing" },
      { mode: "live", status: "disconnected", checkoutEnabled: false, webhookStatus: "missing" }
    ],
    billingStripeCatalogueMappings: [],
    billingStripeCatalogueRevisions: [],
    billingCheckoutOrders: [],
    billingStripeSubscriptionMigrations: [],
    promptTemplates: defaultPromptTemplates,
    rolePermissions: defaultRolePermissions
  };
  ensureBillingDefaults(db);
  return db;
}

export function normalizeDb(db: Database): Database {
  db.users ||= [];
  db.workspaces ||= [];
  db.brandKits ||= [];
  db.competitors ||= [];
  for (const user of db.users) {
    user.email = String(user.email || "").trim();
    user.name = String(user.name || user.email.split("@")[0] || "User").trim();
    if (typeof user.emailVerified !== "boolean") user.emailVerified = true;
    if (!user.createdAt) user.createdAt = new Date().toISOString();
    if (!user.updatedAt) user.updatedAt = user.createdAt;
    user.stripeCustomerIds ||= {};
    if (user.stripeCustomerId && !user.stripeCustomerIds.test) user.stripeCustomerIds.test = user.stripeCustomerId;
  }
  db.competitorResults ||= [];
  db.researchScans ||= [];
  db.socialAudits ||= [];
  db.activity ||= [];
  db.debugLogs ||= [];
  db.automationRules ||= [];
  db.automationJobs ||= [];
  db.automationSourceWatchers ||= [];
  db.automationSourceRuns ||= [];
  db.apiKeyOverrides ||= [];
  db.billingPricingSyncRuns ||= [];
  db.billingPricingAlerts ||= [];
  db.billingSubscriptions ||= [];
  db.billingStripeEvents ||= [];
  db.billingStripeConnections ||= [];
  for (const mode of ["test", "live"] as const) {
    if (!db.billingStripeConnections.some((item) => item.mode === mode)) {
      db.billingStripeConnections.push({ mode, status: "disconnected", checkoutEnabled: false, webhookStatus: "missing" });
    }
  }
  db.billingStripeCatalogueMappings ||= [];
  db.billingStripeCatalogueRevisions ||= [];
  db.billingCheckoutOrders ||= [];
  db.billingStripeSubscriptionMigrations ||= [];
  ensureBillingDefaults(db);
  db.promptTemplates = { ...defaultPromptTemplates, ...(db.promptTemplates || {}) };
  const existingPermissions = (db as Database & { rolePermissions?: Partial<RolePermissions> }).rolePermissions || {};
  db.rolePermissions = allRoles.reduce((acc, role) => {
    const source = role === "owner" || role === "super_admin"
      ? allPermissionKeys
      : Array.isArray(existingPermissions[role]) ? existingPermissions[role] as PermissionKey[] : defaultRolePermissions[role] || [];
    acc[role] = Array.from(new Set(source))
      .filter((permission): permission is PermissionKey => allPermissionKeys.includes(permission as PermissionKey));
    return acc;
  }, {} as RolePermissions);
  if (!db.promptTemplates.researchVideoRecreate.includes("{{durationLine}}") && !db.promptTemplates.researchVideoRecreate.toLowerCase().includes("the video duration is supposed to be")) {
    db.promptTemplates.researchVideoRecreate = `${db.promptTemplates.researchVideoRecreate.trim()} {{durationLine}}`;
  }
  db.personaProfiles ||= [];
  for (const workspace of db.workspaces || []) {
    const existing = db.personaProfiles.find((item) => item.workspaceId === workspace.id);
    if (existing) {
      const normalized = normalizePersonaProfile(workspace.id, existing as PersonaProfile & Record<string, unknown>);
      Object.keys(existing).forEach((key) => delete (existing as Record<string, unknown>)[key]);
      Object.assign(existing, normalized);
    } else {
      db.personaProfiles.push(defaultPersonaProfile(workspace.id));
    }
  }
  return db;
}

export async function readDb(): Promise<Database> {
  if (postgresEnabled()) return readPostgresDb(seeded, normalizeDb);
  if (gcsBucket) {
    try {
      return await readGcsDb();
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "GCS data store read failed; falling back to local JSON store.");
    }
  }
  await fs.mkdir(localDataDir, { recursive: true });
  try {
    return normalizeDb(JSON.parse(await fs.readFile(dataFile, "utf8")) as Database);
  } catch {
    const db = seeded();
    await writeDb(db);
    return db;
  }
}

export async function writeDb(db: Database) {
  if (postgresEnabled()) {
    await writePostgresDb(normalizeDb(db));
    return;
  }
  if (gcsBucket) {
    try {
      await writeGcsDb(db);
      return;
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "GCS data store write failed; falling back to local JSON store.");
    }
  }
  await fs.mkdir(localDataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(db, null, 2));
}

export async function mutateDb<T>(fn: (db: Database) => T | Promise<T>) {
  if (postgresEnabled()) return mutatePostgresDb(seeded, normalizeDb, fn);
  const db = await readDb();
  const result = await fn(db);
  await writeDb(db);
  return result;
}

async function readGcsDb(): Promise<Database> {
  const url = gcsObjectUrl();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await googleAccessToken()}` }, cache: "no-store" });
  if (res.status === 404) {
    const db = seeded();
    await writeGcsDb(db);
    return db;
  }
  if (!res.ok) throw new Error(`Failed to read data store from GCS: HTTP ${res.status} ${await res.text()}`);
  return normalizeDb((await res.json()) as Database);
}

async function writeGcsDb(db: Database) {
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(gcsBucket!)}/o?uploadType=media&name=${encodeURIComponent(gcsObject)}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await googleAccessToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(db, null, 2)
  });
  if (!res.ok) throw new Error(`Failed to write data store to GCS: HTTP ${res.status} ${await res.text()}`);
}

function gcsObjectUrl() {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(gcsBucket!)}/o/${encodeURIComponent(gcsObject)}?alt=media`;
}

async function googleAccessToken() {
  const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
  const res = await fetch(metadataUrl, { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to get Google metadata token: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google metadata token response did not include an access token.");
  return json.access_token;
}
