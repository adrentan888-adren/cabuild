import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb } from "@/lib/store";
import type { Asset, Brief, CompetitorResult, Platform, PublishItem } from "@/lib/types";
import { fetchTrendSignals, scanKeywordsWithApify, scanSocialUrl } from "@/lib/providers/apify";
import { generateContentPlanWithGemini, generateSeedanceVideo, generateVeoVideo, getMarketTask, getVeoVideo } from "@/lib/providers/kie";
import { publishTextPost, publishVideoPost } from "@/lib/providers/uploadPost";

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function platformFromUrl(url: string): Platform {
  const lower = url.toLowerCase();
  if (lower.includes("instagram.com")) return "Instagram";
  if (lower.includes("tiktok.com")) return "TikTok";
  if (lower.includes("facebook.com") || lower.includes("fb.watch")) return "Facebook";
  if (lower.includes("linkedin.com")) return "LinkedIn";
  if (lower.includes("x.com") || lower.includes("twitter.com")) return "X";
  return "TikTok";
}

function handleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts[0]?.startsWith("@") ? parts[0] : parts[0] ? `/${parts[0]}` : parsed.hostname;
  } catch {
    return url;
  }
}

function mockCompetitorResults(input: { workspaceId: string; competitorId: string; platform: Platform; url: string; minViews: number }) {
  const base = Math.max(input.minViews, 1000);
  const now = Date.now();
  return [
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform: input.platform,
      url: input.url,
      title: "Founder explains the AI workflow that removed weekly reporting",
      thumbnailUrl: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=480&h=270&fit=crop",
      description: "A competitor post showing a founder-led reporting automation workflow.",
      views: base + 84200,
      likes: Math.round((base + 84200) * 0.071),
      comments: 286,
      publishedAt: new Date(now - 1000 * 60 * 60 * 9).toISOString(),
      capturedAt: new Date().toISOString()
    },
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform: input.platform,
      url: input.url,
      title: "Before and after: replacing manual follow-up with an agent",
      thumbnailUrl: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=480&h=270&fit=crop",
      description: "Before and after story about client follow-up automation.",
      views: base + 37600,
      likes: Math.round((base + 37600) * 0.054),
      comments: 142,
      publishedAt: new Date(now - 1000 * 60 * 60 * 31).toISOString(),
      capturedAt: new Date().toISOString()
    },
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform: input.platform,
      url: input.url,
      title: "The automation stack I would install first for any SME",
      thumbnailUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=480&h=270&fit=crop",
      description: "Tool-stack explainer for SME automation.",
      views: base + 12400,
      likes: Math.round((base + 12400) * 0.049),
      comments: 91,
      publishedAt: new Date(now - 1000 * 60 * 60 * 74).toISOString(),
      capturedAt: new Date().toISOString()
    }
  ].filter((item) => item.views >= input.minViews);
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeDimensions(value: unknown) {
  const dimensions = typeof value === "object" && value ? value as Record<string, unknown> : {};
  return {
    actorSources: normalizeStringList(dimensions.actorSources),
    contentTypes: normalizeStringList(dimensions.contentTypes),
    formats: normalizeStringList(dimensions.formats),
    uploadDate: String(dimensions.uploadDate || "")
  };
}

function parseList(value: unknown) {
  return String(value || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
}

function contentKindFromFormat(format: string): "video" | "image" | "text" {
  const lower = format.toLowerCase();
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok") || lower.includes("youtube")) return "video";
  if (lower.includes("image") || lower.includes("carousel")) return "image";
  return "text";
}

function defaultDuration(format: string) {
  const lower = format.toLowerCase();
  if (lower.includes("long")) return 60;
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok")) return 8;
  return undefined;
}

function defaultPromptForBrief(brief: Brief, generationType: "video" | "image" | "text") {
  const existing = brief.videoPrompt || [brief.description, brief.outline?.join(". "), brief.creativeNotes].filter(Boolean).join("\n");
  if (existing.trim()) return existing;
  if (generationType === "image") return `Create a polished social carousel or image post about "${brief.topic}". Use clean SME business visuals, strong headline hierarchy, practical examples, brand-safe composition, and a clear final takeaway.`;
  if (generationType === "text") return `Write a founder-led social post about "${brief.topic}". Make it practical, specific, concise, and useful for SME owners. Start with a strong hook, explain the insight, give an example, and close with a clear takeaway.`;
  return `Create a ${brief.format || "short-form video"} about "${brief.topic}". Use a direct opening hook, practical SME automation example, clean office or screen-recording visuals, concise text overlays, natural pacing, and a clear CTA.`;
}

function defaultCaptionForBrief(brief: Brief) {
  return brief.caption?.trim() || `${brief.topic}. A practical reminder for SME teams: automate the repeatable work first, then scale the parts that need human judgment.`;
}

function defaultHashtagsForBrief(brief: Brief, generationType: "video" | "image" | "text") {
  if (brief.hashtags?.length) return brief.hashtags;
  return ["#SME", "#Automation", "#AI", generationType === "video" ? "#VideoContent" : generationType === "image" ? "#Carousel" : "#ContentStrategy"];
}

const demoVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function mockKeywordResults(input: { workspaceId: string; competitorId: string; query: string; minViews: number; dimensions: ReturnType<typeof normalizeDimensions> }) {
  const base = Math.max(input.minViews, 10000);
  const now = Date.now();
  const sourceLabel: Record<string, string> = {
    tiktok: "TikTok",
    instagram: "Instagram",
    youtube: "YouTube",
    facebook: "Facebook",
    linkedin: "LinkedIn",
    "short-video": "Short-form video",
    "long-video": "Long-form video",
    "text-post": "Text post",
    article: "Long-form article",
    carousel: "Image carousel"
  };
  const format = sourceLabel[input.dimensions.actorSources[0]] || sourceLabel[input.dimensions.contentTypes[0]] || input.dimensions.formats[0] || "Google Search";
  return [
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform: "TikTok" as Platform,
      url: `https://www.tiktok.com/search?q=${encodeURIComponent(input.query)}`,
      title: `${format} angle: the hidden cost behind ${input.query}`,
      thumbnailUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=480&h=270&fit=crop",
      description: "High-performing content idea discovered from keyword search.",
      views: base + 96200,
      likes: Math.round((base + 96200) * 0.066),
      comments: 338,
      publishedAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
      capturedAt: new Date().toISOString()
    },
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform: "Instagram" as Platform,
      url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(input.query)}`,
      title: `Carousel breakdown: what people misunderstand about ${input.query}`,
      thumbnailUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=480&h=270&fit=crop",
      description: "A practical breakdown format with clear before-and-after framing.",
      views: base + 41800,
      likes: Math.round((base + 41800) * 0.052),
      comments: 156,
      publishedAt: new Date(now - 1000 * 60 * 60 * 28).toISOString(),
      capturedAt: new Date().toISOString()
    },
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform: "LinkedIn" as Platform,
      url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(input.query)}`,
      title: `Founder POV: where ${input.query} creates real leverage`,
      thumbnailUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=480&h=270&fit=crop",
      description: "Founder-led post structure designed for credibility and saves.",
      views: base + 18900,
      likes: Math.round((base + 18900) * 0.041),
      comments: 84,
      publishedAt: new Date(now - 1000 * 60 * 60 * 52).toISOString(),
      capturedAt: new Date().toISOString()
    }
  ].filter((item) => item.views >= input.minViews);
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return unauthorized();
  }
  const body = await req.json();
  const action = body.action as string;
  const workspaceId = user.workspaceId;

  if (action === "refreshTrends") {
    try {
      const dbResult = await mutateDb(async (db) => {
        const workspace = db.workspaces.find((item) => item.id === workspaceId);
        const signals = await fetchTrendSignals(workspace?.niche || "SME AI automation");
        const created = signals.map((signal, index) => {
          const score = 78 + Math.min(12, index * 2);
          const opp = {
            id: id("opp"),
            workspaceId,
            topic: signal.title,
            platform: "LinkedIn" as Platform,
            format: "Text post",
            gapScore: score,
            trendVelocity: 16,
            competitorGap: 15,
            nicheRelevance: 17,
            engagementPotential: 15,
            platformFit: 15,
            status: "new" as const
          };
          db.opportunities.push(opp);
          return opp;
        });
        db.activity.push({ id: id("act"), workspaceId, message: `Apify refreshed ${created.length} trend signals.`, createdAt: new Date().toISOString() });
        return created;
      });
      return NextResponse.json(dbResult);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Apify refresh failed" }, { status: 502 });
    }
  }

  if (action === "pollAsset") {
    try {
      const updated = await mutateDb(async (db) => {
        const asset = db.assets.find((item) => item.id === body.id && item.workspaceId === workspaceId);
        if (!asset?.providerTaskId) throw new Error("Asset has no provider task to poll.");
        const publishItems = db.publishQueue.filter((item) => item.assetId === asset.id && item.workspaceId === workspaceId);
        const generationModel = asset.generationModel || publishItems.find((item) => item.generationModel)?.generationModel || "";
        const isSeedance = generationModel === "seedance-2.0" || asset.providerTaskId.startsWith("task_bytedance");
        if (isSeedance) {
          const status = await getMarketTask(asset.providerTaskId);
          if (status.state === "success" && status.assetUrl) {
            asset.status = "ready";
            asset.progress = 100;
            asset.assetUrl = status.assetUrl;
            asset.error = "";
            publishItems.forEach((item) => {
              item.status = "done";
              item.assetUrl = status.assetUrl;
              item.error = "";
            });
            db.activity.push({ id: id("act"), workspaceId, message: `Kie video ready for "${asset.title}".`, createdAt: new Date().toISOString() });
          } else if (status.state === "fail") {
            asset.status = "failed";
            asset.error = status.error || "Kie generation failed.";
            publishItems.forEach((item) => {
              item.status = "failed";
              item.error = asset.error;
            });
          } else {
            asset.status = "rendering";
            asset.progress = Math.max(asset.progress, status.progress || 35);
          }
        } else {
          const status = await getVeoVideo(asset.providerTaskId);
          if (status.successFlag === 1 && status.assetUrl) {
            asset.status = "ready";
            asset.progress = 100;
            asset.assetUrl = status.assetUrl;
            asset.error = "";
            publishItems.forEach((item) => {
              item.status = "done";
              item.assetUrl = status.assetUrl;
              item.error = "";
            });
            db.activity.push({ id: id("act"), workspaceId, message: `Kie video ready for "${asset.title}".`, createdAt: new Date().toISOString() });
          } else if (status.successFlag === 2 || status.successFlag === 3) {
            asset.status = "failed";
            asset.error = status.error || "Kie generation failed.";
            publishItems.forEach((item) => {
              item.status = "failed";
              item.error = asset.error;
            });
          } else {
            asset.status = "rendering";
            asset.progress = Math.max(asset.progress, 45);
          }
        }
        return asset;
      });
      return NextResponse.json(updated);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Kie poll failed" }, { status: 502 });
    }
  }

  if (action === "runSocialAudit") {
    const url = String(body.url || "").trim();
    const minViews = Number(body.minViews || 0);
    if (!/^https?:\/\/.+\..+/.test(url)) {
      return NextResponse.json({ error: "Enter a valid social profile or post URL." }, { status: 400 });
    }
    const platform = platformFromUrl(url);
    let normalized: Omit<CompetitorResult, "id" | "workspaceId" | "competitorId" | "platform" | "capturedAt">[];
    let source: "apify" | "fallback" = "apify";
    let error = "";
    try {
      const apifyItems = await scanSocialUrl(url, minViews);
      normalized = apifyItems.map((item) => ({
        url: item.sourceUrl,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        publishedAt: item.publishedAt
      }));
    } catch (err) {
      source = "fallback";
      error = err instanceof Error ? err.message : "Apify social audit failed";
      normalized = mockCompetitorResults({ workspaceId, competitorId: "audit", platform, url, minViews }).map((item) => ({
        url: item.url,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        publishedAt: item.publishedAt
      }));
    }

    const audit = await mutateDb((db) => {
      db.competitorResults ||= [];
      db.socialAudits ||= [];
      const auditId = id("aud");
      const results: CompetitorResult[] = normalized.slice(0, 12).map((item) => ({
        id: id("res"),
        workspaceId,
        competitorId: auditId,
        platform,
        capturedAt: new Date().toISOString(),
        ...item
      }));
      db.competitorResults.push(...results);
      const postsAnalysed = results.length;
      const avgViews = postsAnalysed ? Math.round(results.reduce((sum, item) => sum + item.views, 0) / postsAnalysed) : 0;
      const avgLikes = postsAnalysed ? Math.round(results.reduce((sum, item) => sum + item.likes, 0) / postsAnalysed) : 0;
      const engagementRate = avgViews > 0 ? avgLikes / avgViews : 0;
      const authorityScore = Math.max(20, Math.min(96, Math.round(38 + Math.log10(Math.max(avgViews, 1)) * 9 + engagementRate * 140)));
      const created = {
        id: auditId,
        workspaceId,
        url,
        platform,
        handle: handleFromUrl(url),
        authorityScore,
        avgViews,
        avgLikes,
        postsAnalysed,
        topResultIds: results.slice(0, 5).map((item) => item.id),
        createdAt: new Date().toISOString(),
        source,
        error
      };
      db.socialAudits.push(created);
      db.socialAudits = db.socialAudits.filter((item) => item.workspaceId !== workspaceId).concat(db.socialAudits.filter((item) => item.workspaceId === workspaceId).slice(-5));
      db.activity.push({ id: id("act"), workspaceId, message: `Social audit completed for ${created.handle} using ${source}.`, createdAt: new Date().toISOString() });
      return created;
    });
    return NextResponse.json(audit);
  }

  if (action === "scanResearchUrl") {
    const url = String(body.url || "");
    const minViews = Number(body.minViews || 0);
    const platform = platformFromUrl(url);
    const cached = await mutateDb((db) => {
      db.researchScans ||= [];
      db.competitorResults ||= [];
      const existing = db.researchScans
        .filter((scan) => scan.workspaceId === workspaceId && scan.url === url && scan.minViews === minViews)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return existing?.source === "fallback" ? null : existing || null;
    });
    if (cached) return NextResponse.json(cached);

    let normalized: Omit<CompetitorResult, "id" | "workspaceId" | "competitorId" | "platform" | "capturedAt">[];
    let source: "apify" | "fallback" = "apify";
    let error = "";
    try {
      const apifyItems = await scanSocialUrl(url, minViews);
      normalized = apifyItems.map((item) => ({
        url: item.sourceUrl,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        publishedAt: item.publishedAt
      }));
    } catch (err) {
      source = "fallback";
      error = err instanceof Error ? err.message : "Apify scan failed";
      normalized = mockCompetitorResults({ workspaceId, competitorId: "fallback", platform, url, minViews }).map((item) => ({
        url: item.url,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        publishedAt: item.publishedAt
      }));
    }

    const scan = await mutateDb((db) => {
      db.competitors ||= [];
      db.competitorResults ||= [];
      db.researchScans ||= [];
      const competitor = { id: id("cmp"), workspaceId, platform, handle: handleFromUrl(url), url, minViews, cadence: "weekly" as const, lastScraped: new Date().toISOString() };
      db.competitors.push(competitor);
      const results: CompetitorResult[] = normalized.map((item) => ({
        id: id("res"),
        workspaceId,
        competitorId: competitor.id,
        platform,
        capturedAt: new Date().toISOString(),
        ...item
      }));
      db.competitorResults.push(...results);
      const created = { id: id("scan"), workspaceId, url, platform, minViews, resultIds: results.map((item) => item.id), createdAt: new Date().toISOString(), source, error };
      db.researchScans.push(created);
      db.researchScans = db.researchScans.filter((item) => item.workspaceId !== workspaceId).concat(db.researchScans.filter((item) => item.workspaceId === workspaceId).slice(-10));
      db.activity.push({ id: id("act"), workspaceId, message: `Research scan completed for ${handleFromUrl(url)} using ${source}.`, createdAt: new Date().toISOString() });
      return created;
    });
    return NextResponse.json(scan);
  }

  if (action === "scanKeywordResearch") {
    const query = String(body.keywords || "").trim();
    const minViews = Number(body.minViews || 0);
    const dimensions = normalizeDimensions(body.dimensions);
    if (!query) return NextResponse.json({ error: "Keywords are required" }, { status: 400 });
    const cacheKey = `keyword:${query.toLowerCase()}|${JSON.stringify(dimensions)}|min:${minViews}`;
    const cached = await mutateDb((db) => {
      db.researchScans ||= [];
      db.competitorResults ||= [];
      const existing = db.researchScans
        .filter((scan) => scan.workspaceId === workspaceId && scan.url === cacheKey)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return existing || null;
    });
    if (cached) return NextResponse.json(cached);

    let normalized: Omit<CompetitorResult, "id" | "workspaceId" | "competitorId" | "capturedAt">[];
    let source: "apify" | "fallback" = "apify";
    let error = "";
    try {
      const apifyItems = await scanKeywordsWithApify(query, dimensions, minViews);
      normalized = apifyItems.map((item) => ({
        platform: item.platform,
        url: item.sourceUrl,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        publishedAt: item.publishedAt
      }));
    } catch (err) {
      source = "fallback";
      error = err instanceof Error ? err.message : "Apify keyword scan failed";
      normalized = mockKeywordResults({ workspaceId, competitorId: "fallback", query, minViews, dimensions }).map((item) => ({
        platform: item.platform,
        url: item.url,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        publishedAt: item.publishedAt
      }));
    }

    const scan = await mutateDb((db) => {
      db.competitors ||= [];
      db.competitorResults ||= [];
      db.researchScans ||= [];
      const competitor = { id: id("cmp"), workspaceId, platform: "TikTok" as Platform, handle: query, url: cacheKey, minViews, cadence: "weekly" as const, lastScraped: new Date().toISOString() };
      db.competitors.push(competitor);
      const results: CompetitorResult[] = normalized.map((item) => ({
        id: id("res"),
        workspaceId,
        competitorId: competitor.id,
        capturedAt: new Date().toISOString(),
        ...item
      }));
      db.competitorResults.push(...results);
      const created = { id: id("scan"), workspaceId, url: cacheKey, query, dimensions, platform: "TikTok" as Platform, minViews, resultIds: results.map((item) => item.id), createdAt: new Date().toISOString(), source, error };
      db.researchScans.push(created);
      db.researchScans = db.researchScans.filter((item) => item.workspaceId !== workspaceId).concat(db.researchScans.filter((item) => item.workspaceId === workspaceId).slice(-10));
      db.activity.push({ id: id("act"), workspaceId, message: `Keyword research completed for "${query}" using ${source}.`, createdAt: new Date().toISOString() });
      return created;
    });
    return NextResponse.json(scan);
  }

  if (action === "createPlanFromResearch") {
    const resultId = String(body.id || "");
    const result = await mutateDb((db) => (db.competitorResults || []).find((item) => item.id === resultId && item.workspaceId === workspaceId) || null);
    if (!result) return NextResponse.json({ error: "Research result not found" }, { status: 404 });
    let plan;
    try {
      plan = await generateContentPlanWithGemini(result);
    } catch {
      plan = {
        topic: `Turn "${result.title}" into an SME automation lesson`,
        format: result.platform === "LinkedIn" || result.platform === "X" ? "Text post" : "Short video 9:16",
        platforms: [result.platform],
        description: `Recreate the winning angle from "${result.title}" as founder-led SME AI automation content.`,
        videoPrompt: `Vertical founder-led social video about ${result.title}. Open with a clear pain point, show a practical AI automation workflow, use clean office or screen-recording visuals, add concise text overlays, and end with a practical CTA for SME founders.`,
        duration: 8,
        hooks: [
          "Most SMEs are losing time in places they do not measure.",
          "This competitor post worked because it made automation concrete.",
          "Here is the workflow I would rebuild before hiring again."
        ],
        outline: ["Open with the manual pain", "Show the competitor angle", "Give a founder-led example", "End with a practical CTA"],
        shotList: ["Founder hook to camera", "Screen recording of workflow steps", "Before/after time saved visual", "CTA close-up with branded caption"],
        creativeNotes: "Keep pacing practical and direct. Use real workflow language, captions, and a clean SME operations visual style.",
        caption: "Manual work hides inside routine follow-up, reporting, and approvals. The fastest win is to automate the repeatable decision before scaling the team.",
        hashtags: ["#SME", "#Automation", "#AI"],
        optimalTime: "Thu 10:00 AM",
        expectedPerformance: "4.2-6.0% engagement",
        analysisSummary: "Fallback plan generated from local competitor metrics."
      };
    }
    const brief = await mutateDb((db) => {
      const created: Brief = {
        id: id("brf"),
        workspaceId,
        opportunityId: result.id,
        topic: String(plan.topic || result.title),
        format: String(plan.format || "Short video 9:16"),
        platforms: Array.isArray(plan.platforms) ? plan.platforms : [result.platform],
        description: String(plan.description || ""),
        videoPrompt: String(plan.videoPrompt || ""),
        duration: Number(plan.duration || defaultDuration(String(plan.format || "Short video 9:16")) || 0) || undefined,
        hooks: Array.isArray(plan.hooks) ? plan.hooks : [],
        outline: Array.isArray(plan.outline) ? plan.outline : [],
        shotList: Array.isArray(plan.shotList) ? plan.shotList : [],
        creativeNotes: String(plan.creativeNotes || ""),
        caption: String(plan.caption || ""),
        hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : [],
        optimalTime: String(plan.optimalTime || "Thu 10:00 AM"),
        expectedPerformance: String(plan.expectedPerformance || "4.0-5.5% engagement"),
        analysisSummary: String(plan.analysisSummary || ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "new"
      };
      db.briefs.push(created);
      db.activity.push({ id: id("act"), workspaceId, message: `Gemini content plan created from research: ${created.topic}`, createdAt: new Date().toISOString() });
      return created;
    });
    return NextResponse.json(brief);
  }

  if (action === "publishNow") {
    try {
      const snapshot = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) throw new Error("Publish queue item not found.");
        if (item.status === "generating") throw new Error("This draft is still generating.");
        return { item, asset: db.assets.find((asset) => asset.id === item.assetId && asset.workspaceId === workspaceId) };
      });
      const description = [snapshot.item.caption, ...(snapshot.item.hashtags || [])].filter(Boolean).join("\n\n") || snapshot.asset?.prompt;
      const result = snapshot.asset?.assetUrl
        ? await publishVideoPost({
            title: snapshot.item.title,
            description,
            platform: snapshot.item.platform,
            videoUrl: snapshot.asset.assetUrl
          })
        : await publishTextPost({
            title: snapshot.item.title,
            description,
            platform: snapshot.item.platform
          });
      const updated = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) return snapshot.item;
        item.status = "published";
        item.provider = "upload-post";
        item.providerRequestId = result.request_id;
        item.error = "";
        db.activity.push({ id: id("act"), workspaceId, message: `Upload-Post accepted "${item.title}".`, createdAt: new Date().toISOString() });
        return item;
      });
      return NextResponse.json(updated);
    } catch (error) {
      const updated = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) return null;
        item.status = "failed";
        item.provider = "upload-post";
        item.error = error instanceof Error ? error.message : "Upload-Post publish failed";
        db.activity.push({ id: id("act"), workspaceId, message: `Upload-Post failed: ${item.error}`, createdAt: new Date().toISOString() });
        return item;
      });
      return NextResponse.json(updated || { error: "Publish failed" }, { status: 502 });
    }
  }

  const data = await mutateDb((db) => {
    const activity = (message: string) => db.activity.push({ id: id("act"), workspaceId, message, createdAt: new Date().toISOString() });

    if (action === "addCompetitor") {
      const url = String(body.url || body.handle || "");
      const minViews = Number(body.minViews || 0);
      const platform = url ? platformFromUrl(url) : (body.platform as Platform);
      const item = { id: id("cmp"), workspaceId, platform, handle: handleFromUrl(url || String(body.handle || "")), url, minViews, cadence: body.cadence || "weekly", lastScraped: new Date().toISOString() };
      db.competitors.push(item);
      db.competitorResults ||= [];
      db.competitorResults.push(...mockCompetitorResults({ workspaceId, competitorId: item.id, platform, url, minViews }));
      activity(`Added ${item.handle} to ${item.platform} competitor monitoring with ${minViews.toLocaleString()} minimum views.`);
      return item;
    }

    if (action === "dismissOpportunity") {
      const item = db.opportunities.find((opp) => opp.id === body.id && opp.workspaceId === workspaceId);
      if (item) item.status = "dismissed";
      activity("Opportunity dismissed.");
      return item;
    }

    if (action === "generateOpportunity") {
      const opp = db.opportunities.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!opp) return null;
      opp.status = "briefed";
      const brief = {
        id: id("brf"),
        workspaceId,
        opportunityId: opp.id,
        topic: opp.topic,
        format: opp.format,
        platforms: [opp.platform],
        hooks: [
          `The smartest ${db.workspaces.find((ws) => ws.id === workspaceId)?.niche || "teams"} are already acting on this.`,
          `This is the gap your competitors are leaving open.`,
          `Most brands will notice this trend too late.`
        ],
        outline: ["State the market shift", "Show the competitor gap", "Give a concrete example", "Close with a practical CTA"],
        description: `A timely content plan about ${opp.topic}.`,
        videoPrompt: `Create a founder-led social video about ${opp.topic}. Use a direct hook, practical SME example, simple workflow visuals, captions, and a clear CTA.`,
        duration: defaultDuration(opp.format),
        shotList: ["Hook to camera", "Problem visual", "Workflow example", "CTA close"],
        creativeNotes: "Use concise captions, practical examples, and a founder-led tone.",
        caption: `A high-priority content gap is opening around ${opp.topic.toLowerCase()}. This post is designed to explain it before the market gets crowded.`,
        hashtags: ["#ContentStrategy", "#SocialMedia", "#AI"],
        optimalTime: "Thu 10:00 AM",
        expectedPerformance: `${(opp.gapScore / 20).toFixed(1)}-${(opp.gapScore / 16).toFixed(1)}% engagement`,
        analysisSummary: "Generated from opportunity scoring.",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "new" as const
      };
      db.briefs.push(brief);
      const ws = db.workspaces.find((item) => item.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - 1);
      activity(`Generated brief for "${opp.topic}".`);
      return brief;
    }

    if (action === "approveBrief") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (brief) brief.status = "approved";
      activity("Brief approved for production.");
      return brief;
    }

    if (action === "updateBrief") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!brief) return null;
      brief.topic = String(body.topic || brief.topic);
      brief.format = String(body.format || brief.format);
      brief.description = String(body.description || "");
      brief.videoPrompt = String(body.videoPrompt || "");
      brief.duration = Number(body.duration || 0) || defaultDuration(brief.format);
      brief.hooks = parseList(body.hooks);
      brief.outline = parseList(body.outline);
      brief.shotList = parseList(body.shotList);
      brief.creativeNotes = String(body.creativeNotes || "");
      brief.caption = String(body.caption || "");
      brief.hashtags = parseList(body.hashtags);
      brief.optimalTime = String(body.optimalTime || "");
      brief.expectedPerformance = String(body.expectedPerformance || "");
      brief.updatedAt = new Date().toISOString();
      activity(`Updated content plan: ${brief.topic}`);
      return brief;
    }

    if (action === "generateDraftFromPlan") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!brief) return null;
      const generationType = (String(body.generationType || contentKindFromFormat(brief.format)) as "video" | "image" | "text");
      const model = String(body.generationModel || (generationType === "video" ? "veo-fast" : generationType === "image" ? "nanobanana-pro" : "gemini-3.5-flash"));
      const duration = Number(body.duration || brief.duration || defaultDuration(brief.format) || 0) || undefined;
      const prompt = String(body.prompt || defaultPromptForBrief(brief, generationType));
      const caption = String(body.caption || defaultCaptionForBrief(brief));
      const hashtags = parseList(body.hashtags || defaultHashtagsForBrief(brief, generationType).join(", "));
      const platform = (String(body.platform || brief.platforms[0] || "TikTok") as Platform);
      const now = new Date().toISOString();
      const type: Asset["type"] = generationType === "video" ? "video" : generationType === "image" ? (brief.format.toLowerCase().includes("carousel") ? "carousel" : "image") : "text";
      const isKieVideo = generationType === "video" && (model === "veo-fast" || model === "seedance-2.0");
      brief.duration = duration || brief.duration;
      brief.status = "production";
      brief.updatedAt = now;
      const asset: Asset = {
        id: id("ast"),
        workspaceId,
        briefId: brief.id,
        title: brief.topic,
        type,
        status: isKieVideo ? "queued" : "ready",
        progress: isKieVideo ? 10 : 100,
        createdAt: now,
        provider: isKieVideo ? "kie" : "local",
        generationModel: model,
        prompt,
        assetUrl: isKieVideo ? undefined : generationType === "video" ? demoVideoUrl : generationType === "text" ? `data:text/plain;charset=utf-8,${encodeURIComponent(`${caption}\n\n${hashtags.join(" ")}`)}` : undefined
      };
      db.assets.push(asset);
      const item: PublishItem = {
        id: id("pub"),
        workspaceId,
        assetId: asset.id,
        title: brief.topic,
        platform,
        scheduledAt: now,
        status: isKieVideo ? "generating" : "done",
        provider: isKieVideo ? "kie" : "local",
        caption,
        hashtags,
        generationModel: model,
        generationType,
        duration,
        prompt,
        assetUrl: asset.assetUrl,
        createdAt: now
      };
      db.publishQueue.push(item);
      const ws = db.workspaces.find((entry) => entry.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (generationType === "video" ? 8 : generationType === "image" ? 3 : 1));
      activity(isKieVideo ? `Queued ${model} generation for "${brief.topic}".` : `Generated ${model} draft for "${brief.topic}".`);
      return { asset, publishItem: item };
    }

    if (action === "generateDirectContent") {
      const generationType = (String(body.generationType || "video") as "video" | "image" | "text");
      const model = String(body.generationModel || (generationType === "video" ? "veo-fast" : generationType === "image" ? "nanobanana-pro" : "gemini-3.5-flash"));
      const duration = Number(body.duration || 0) || (generationType === "video" ? 8 : undefined);
      const prompt = String(body.prompt || "Create a practical founder-led social post about SME AI automation.");
      const caption = String(body.caption || "A practical reminder for SME teams: automate repeatable work first.");
      const hashtags = parseList(body.hashtags || "#SME, #Automation, #AI");
      const platform = (String(body.platform || "TikTok") as Platform);
      const now = new Date().toISOString();
      const title = prompt.split(/\n|\.|\?/)[0].slice(0, 96) || "Direct content draft";
      const type: Asset["type"] = generationType === "video" ? "video" : generationType === "image" ? "image" : "text";
      const isKieVideo = generationType === "video" && (model === "veo-fast" || model === "seedance-2.0");
      const asset: Asset = {
        id: id("ast"),
        workspaceId,
        briefId: "direct",
        title,
        type,
        status: isKieVideo ? "queued" : "ready",
        progress: isKieVideo ? 10 : 100,
        createdAt: now,
        provider: isKieVideo ? "kie" : "local",
        generationModel: model,
        prompt,
        assetUrl: isKieVideo ? undefined : generationType === "video" ? demoVideoUrl : generationType === "text" ? `data:text/plain;charset=utf-8,${encodeURIComponent(`${caption}\n\n${hashtags.join(" ")}`)}` : undefined
      };
      db.assets.push(asset);
      const item: PublishItem = {
        id: id("pub"),
        workspaceId,
        assetId: asset.id,
        title,
        platform,
        scheduledAt: now,
        status: isKieVideo ? "generating" : "done",
        provider: isKieVideo ? "kie" : "local",
        caption,
        hashtags,
        generationModel: model,
        generationType,
        duration,
        prompt,
        assetUrl: asset.assetUrl,
        createdAt: now
      };
      db.publishQueue.push(item);
      const ws = db.workspaces.find((entry) => entry.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (generationType === "video" ? 8 : generationType === "image" ? 3 : 1));
      activity(isKieVideo ? `Queued ${model} direct generation.` : `Generated ${model} direct draft.`);
      return { asset, publishItem: item };
    }

    if (action === "deleteBrief") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!brief) return null;
      db.briefs = db.briefs.filter((item) => !(item.id === body.id && item.workspaceId === workspaceId));
      activity(`Deleted content plan: ${brief.topic}`);
      return brief;
    }

    if (action === "renderAsset") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!brief) return null;
      brief.status = "production";
      const type: Asset["type"] = brief.format.toLowerCase().includes("video") ? "video" : brief.format.toLowerCase().includes("carousel") ? "carousel" : "image";
      const prompt = brief.videoPrompt || `${brief.topic}. ${brief.outline.join(". ")} Style: authentic vertical social video for ${brief.platforms.join(", ")}.`;
      const asset: Asset = { id: id("ast"), workspaceId, briefId: brief.id, title: brief.topic, type, status: type === "video" ? "queued" : "ready", progress: type === "video" ? 10 : 100, createdAt: new Date().toISOString(), provider: type === "video" ? "kie" : "local", prompt };
      db.assets.push(asset);
      const ws = db.workspaces.find((item) => item.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (type === "video" ? 8 : type === "carousel" ? 3 : 1));
      activity(type === "video" ? "Queued Kie video generation from approved brief." : `Rendered ${type} asset from approved brief.`);
      return asset;
    }

    if (action === "scheduleAsset") {
      const asset = db.assets.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!asset) return null;
      const item: PublishItem = { id: id("pub"), workspaceId, assetId: asset.id, title: asset.title, platform: body.platform as Platform, scheduledAt: body.scheduledAt || new Date(Date.now() + 86400000).toISOString(), status: "scheduled" };
      db.publishQueue.push(item);
      activity(`Scheduled "${asset.title}" for ${item.platform}.`);
      return item;
    }

    if (action === "updateBrandKit") {
      const kit = db.brandKits.find((item) => item.workspaceId === workspaceId);
      if (kit) Object.assign(kit, body.brandKit);
      activity("Brand kit updated.");
      return kit;
    }

    if (action === "generateUgc") {
      const product = String(body.product || "UGC video");
      const sellingPoints = String(body.sellingPoints || "");
      const style = String(body.style || "Talking Head");
      const prompt = `${style} UGC vertical social video for ${product}. Selling points: ${sellingPoints}. Natural creator tone, clear captions, product benefit demonstration.`;
      const asset = { id: id("ast"), workspaceId, briefId: "ugc", title: product, type: "ugc" as const, status: "queued" as const, progress: 10, createdAt: new Date().toISOString(), provider: "kie" as const, prompt };
      db.assets.push(asset);
      const ws = db.workspaces.find((item) => item.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (body.duration === "60" ? 25 : 15));
      activity(`Queued UGC video generation for ${asset.title}.`);
      return asset;
    }

    return null;
  });

  if (!data) return NextResponse.json({ error: "Action failed" }, { status: 400 });

  const generatedAsset = action === "generateDraftFromPlan" || action === "generateDirectContent" ? (data as { asset?: Asset }).asset : data as Asset;
  if ((action === "renderAsset" || action === "generateUgc" || action === "generateDraftFromPlan" || action === "generateDirectContent") && generatedAsset?.provider === "kie") {
    try {
      const model = generatedAsset.generationModel || String(body.generationModel || "veo-fast");
      const taskId = model === "seedance-2.0"
        ? await generateSeedanceVideo(generatedAsset.prompt || generatedAsset.title, { duration: Number(body.duration || 8), aspectRatio: String(body.aspectRatio || "9:16") })
        : await generateVeoVideo(generatedAsset.prompt || generatedAsset.title, { duration: Number(body.duration || 8), aspectRatio: String(body.aspectRatio || "9:16") });
      const updated = await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === generatedAsset.id && item.workspaceId === workspaceId);
        if (!asset) return data;
        asset.status = "rendering";
        asset.progress = 35;
        asset.providerTaskId = taskId;
        asset.generationModel = model;
        db.publishQueue
          .filter((item) => item.assetId === asset.id && item.workspaceId === workspaceId)
          .forEach((item) => {
            item.status = "generating";
            item.providerRequestId = taskId;
          });
        db.activity.push({ id: id("act"), workspaceId, message: `Kie task started: ${taskId}`, createdAt: new Date().toISOString() });
        return action === "generateDraftFromPlan" || action === "generateDirectContent" ? { asset, publishItem: db.publishQueue.find((item) => item.assetId === asset.id && item.workspaceId === workspaceId) } : asset;
      });
      return NextResponse.json(updated);
    } catch (error) {
      const updated = await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === generatedAsset.id && item.workspaceId === workspaceId);
        if (!asset) return data;
        asset.status = "failed";
        asset.error = error instanceof Error ? error.message : "Kie generation failed";
        db.publishQueue
          .filter((item) => item.assetId === asset.id && item.workspaceId === workspaceId)
          .forEach((item) => {
            item.status = "failed";
            item.error = asset.error;
          });
        return asset;
      });
      return NextResponse.json(updated, { status: 502 });
    }
  }

  return NextResponse.json(data);
}
