import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Database, PersonaProfile, Platform, PromptTemplates } from "./types";

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "app.json");
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
  const [salt, hash] = stored.split(":");
  return hashPassword(password, salt).split(":")[1] === hash;
}

export function defaultPersonaProfile(workspaceId: string): PersonaProfile {
  return {
    workspaceId,
    fullName: "Sean Tan",
    jobTitle: "CEO",
    company: "",
    industry: "Technology",
    preferredName: "Sean",
    companyOneLiner: "",
    yearsExperience: "",
    pronouns: "I (first person)",
    credentialTags: [],
    primaryAudience: "",
    painPoint: "",
    contentLanguage: "English only",
    audienceFear: "",
    audienceAspiration: "",
    secondaryAudience: "",
    includePersonalLife: false,
    toneFormalCasual: 3,
    toneSeriousHumorous: 2,
    toneReservedBold: 4,
    naturalPhrases: ["Here's the thing"],
    bannedVocabulary: ["synergy", "disruptive"],
    primaryContentGoal: "Thought leadership",
    ctaStyle: "Soft",
    approvedTopics: ["AI automation"],
    offLimitsTopics: [],
    strongOpinions: "",
    writingSamples: [],
    faceReferenceFileName: "",
    voiceSampleFileName: "",
    allowAiFace: false,
    allowAiVoice: false,
    autoAiDisclosure: true,
    sourceUrls: { linkedin: "", website: "", instagram: "", facebook: "", x: "" },
    updatedAt: new Date().toISOString()
  };
}

export const defaultPromptTemplates: PromptTemplates = {
  researchVideoRecreate: "Please analyse the attached video and write the prompt to recreate this video in JSON format in very detailed terms, no more than 3000 characters. Source video: {{sourceMediaUrl}}. Source page/post: {{sourceUrl}}. Source title: {{sourceTitle}}. {{assetInstruction}}",
  researchImageRecreate: "Please analyse the attached image/graphic and write the prompt to recreate this image in JSON format in very detailed terms, no more than 3000 characters. Source image: {{sourceMediaUrl}}. Source page/post: {{sourceUrl}}. Source title: {{sourceTitle}}. {{assetInstruction}}"
};

function seeded(): Database {
  const workspaceId = "ws_demo";
  const userId = "usr_demo";
  const platforms: Platform[] = ["TikTok", "Instagram", "LinkedIn", "Facebook"];
  return {
    users: [
      {
        id: userId,
        email: "demo@contentagent.tech",
        name: "Sean Tan",
        passwordHash: hashPassword("demo1234"),
        role: "owner",
        workspaceId
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
    activity: [
      { id: id("act"), workspaceId, message: "Detected TikTok automation topic crossing high-priority threshold.", createdAt: new Date().toISOString() }
    ],
    debugLogs: [],
    promptTemplates: defaultPromptTemplates
  };
}

function normalizeDb(db: Database): Database {
  db.competitorResults ||= [];
  db.researchScans ||= [];
  db.socialAudits ||= [];
  db.activity ||= [];
  db.debugLogs ||= [];
  db.promptTemplates = { ...defaultPromptTemplates, ...(db.promptTemplates || {}) };
  db.personaProfiles ||= [];
  for (const workspace of db.workspaces || []) {
    const existing = db.personaProfiles.find((item) => item.workspaceId === workspace.id);
    if (existing) {
      const fallback = defaultPersonaProfile(workspace.id);
      Object.assign(existing, { ...fallback, ...existing, sourceUrls: { ...fallback.sourceUrls, ...(existing.sourceUrls || {}) } });
    } else {
      db.personaProfiles.push(defaultPersonaProfile(workspace.id));
    }
  }
  return db;
}

export async function readDb(): Promise<Database> {
  if (gcsBucket) {
    try {
      return await readGcsDb();
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "GCS data store read failed; falling back to local JSON store.");
    }
  }
  await fs.mkdir(dataDir, { recursive: true });
  try {
    return normalizeDb(JSON.parse(await fs.readFile(dataFile, "utf8")) as Database);
  } catch {
    const db = seeded();
    await writeDb(db);
    return db;
  }
}

export async function writeDb(db: Database) {
  if (gcsBucket) {
    try {
      await writeGcsDb(db);
      return;
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "GCS data store write failed; falling back to local JSON store.");
    }
  }
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(db, null, 2));
}

export async function mutateDb<T>(fn: (db: Database) => T | Promise<T>) {
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
