import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Database, Platform } from "./types";

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "app.json");

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
    ]
  };
}

export async function readDb(): Promise<Database> {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(dataFile, "utf8")) as Database;
  } catch {
    const db = seeded();
    await writeDb(db);
    return db;
  }
}

export async function writeDb(db: Database) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(db, null, 2));
}

export async function mutateDb<T>(fn: (db: Database) => T | Promise<T>) {
  const db = await readDb();
  const result = await fn(db);
  await writeDb(db);
  return result;
}
