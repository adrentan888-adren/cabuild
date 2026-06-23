import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { defaultPersonaProfile, id, mutateDb } from "@/lib/store";
import type { Asset, Brief, CompetitorResult, GenerationAssetReference, PersonaProfile, Platform, PublishItem } from "@/lib/types";
import { fetchTrendSignals, scanKeywordsWithApify, scanSocialUrl } from "@/lib/providers/apify";
import { buildAiBriefPrompt, buildContentPlanPrompt, generateContentPlanWithGemini, generateContentPlanWithGpt55, generateImage, generateSeedanceVideo, generateVeoVideo, getMarketTask, getVeoVideo } from "@/lib/providers/kie";
import { getConnectedUploadPostAccounts, publishTextPost, publishVideoPost } from "@/lib/providers/uploadPost";

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

function isKieImageModel(model: string) {
  return model === "nanobanana-pro" || model === "gpt-image-2";
}

function summarizePayload(body: Record<string, unknown>) {
  const omitted = new Set(["prompt", "videoPrompt", "caption", "hashtags"]);
  return Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => !omitted.has(key) && !key.toLowerCase().includes("token") && !key.toLowerCase().includes("password"))
      .map(([key, value]) => {
        if (typeof value === "string") return [key, value.length > 240 ? `${value.slice(0, 240)}...` : value];
        return [key, value];
      })
  );
}

async function debugLog(workspaceId: string, entry: { action: string; label: string; status: "started" | "success" | "failed" | "info"; provider?: "apify" | "kie" | "upload-post" | "local" | "system"; prompt?: string; details?: Record<string, unknown>; error?: string }) {
  await mutateDb((db) => {
    db.debugLogs ||= [];
    db.debugLogs.push({ id: id("log"), workspaceId, createdAt: new Date().toISOString(), ...entry });
    const scoped = db.debugLogs.filter((item) => item.workspaceId === workspaceId);
    if (scoped.length > 500) {
      const keep = new Set(scoped.slice(-500).map((item) => item.id));
      db.debugLogs = db.debugLogs.filter((item) => item.workspaceId !== workspaceId || keep.has(item.id));
    }
  });
}

function parseAssetReferences(input: unknown): GenerationAssetReference[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const ref = item as Record<string, unknown>;
      const role = String(ref.role || "").trim();
      const fileName = String(ref.fileName || "").trim();
      const url = String(ref.url || "").trim();
      const storageKey = String(ref.storageKey || "").trim();
      const contentType = String(ref.contentType || "").trim();
      return role && fileName ? { role, fileName, ...(url ? { url } : {}), ...(storageKey ? { storageKey } : {}), ...(contentType ? { contentType } : {}) } : null;
    })
    .filter((item): item is GenerationAssetReference => Boolean(item));
}

function enrichPromptWithAssetReferences(prompt: string, generationType: "video" | "image" | "text", refs: GenerationAssetReference[]) {
  if (generationType === "text" || refs.length === 0 || prompt.includes("Required uploaded reference usage")) return prompt;
  const mediaLabel = generationType === "image" ? "image" : "video";
  const productRef = refs.find((ref) => ref.role === "product photo");
  const avatarRef = refs.find((ref) => ref.role === "avatar/persona");
  const logoRef = refs.find((ref) => ref.role === "logo");
  const refLabel = (ref: GenerationAssetReference) => `"${ref.fileName}"${ref.url ? ` at ${ref.url}` : ""}`;
  const lines = [
    productRef ? `- Product photo reference ${refLabel(productRef)}: include the product/photo visibly as a main visual element. Preserve important details and integrate it naturally.` : "",
    avatarRef ? `- Avatar/persona reference ${refLabel(avatarRef)}: use this as the on-screen person/creator/persona reference and keep it recognizable.` : "",
    logoRef ? `- Logo reference ${refLabel(logoRef)}: include this exact brand logo clearly in the ${mediaLabel}. Do not replace it with generic text or an invented logo.` : ""
  ].filter(Boolean);
  return [
    prompt,
    [
      `Required uploaded reference usage for this ${mediaLabel}:`,
      ...lines,
      `All selected uploaded elements must appear in the final ${mediaLabel}. Add stroke, outline, drop shadow, backing shape, spacing, or contrast so the uploaded logo/photo/persona are clearly distinguishable from the background.`,
      generationType === "video"
        ? "For video, keep the logo visible in the opening or ending brand frame and include the product/persona reference in the main scene or B-roll."
        : "For image, make the logo and product/persona references readable at mobile feed size with clean negative space."
    ].join("\n")
  ].join("\n\n");
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

function parseBool(value: unknown) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function clampTone(value: unknown, fallback: number) {
  const numeric = Number(value || fallback);
  return Math.min(5, Math.max(1, Number.isFinite(numeric) ? numeric : fallback));
}

function hasField(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function stringField(body: Record<string, unknown>, key: string, fallback = "") {
  return hasField(body, key) ? String(body[key] || "").trim() : fallback;
}

function listField(body: Record<string, unknown>, key: string, fallback: string[]) {
  return hasField(body, key) ? parseList(body[key]) : fallback;
}

function boolField(body: Record<string, unknown>, key: string, fallback: boolean) {
  return hasField(body, key) ? parseBool(body[key]) : fallback;
}

function personaFromBody(workspaceId: string, body: Record<string, unknown>, previous?: PersonaProfile): PersonaProfile {
  const fallback = previous || defaultPersonaProfile(workspaceId);
  return {
    ...fallback,
    fullName: stringField(body, "fullName", fallback.fullName),
    jobTitle: stringField(body, "jobTitle", fallback.jobTitle),
    company: stringField(body, "company", fallback.company),
    industry: stringField(body, "industry", fallback.industry),
    preferredName: stringField(body, "preferredName", fallback.preferredName),
    companyOneLiner: stringField(body, "companyOneLiner", fallback.companyOneLiner),
    yearsExperience: stringField(body, "yearsExperience", fallback.yearsExperience),
    pronouns: stringField(body, "pronouns", fallback.pronouns),
    credentialTags: listField(body, "credentialTags", fallback.credentialTags),
    primaryAudience: stringField(body, "primaryAudience", fallback.primaryAudience),
    painPoint: stringField(body, "painPoint", fallback.painPoint),
    contentLanguage: stringField(body, "contentLanguage", fallback.contentLanguage),
    audienceFear: stringField(body, "audienceFear", fallback.audienceFear),
    audienceAspiration: stringField(body, "audienceAspiration", fallback.audienceAspiration),
    secondaryAudience: stringField(body, "secondaryAudience", fallback.secondaryAudience),
    includePersonalLife: boolField(body, "includePersonalLife", fallback.includePersonalLife),
    toneFormalCasual: hasField(body, "toneFormalCasual") ? clampTone(body.toneFormalCasual, fallback.toneFormalCasual) : fallback.toneFormalCasual,
    toneSeriousHumorous: hasField(body, "toneSeriousHumorous") ? clampTone(body.toneSeriousHumorous, fallback.toneSeriousHumorous) : fallback.toneSeriousHumorous,
    toneReservedBold: hasField(body, "toneReservedBold") ? clampTone(body.toneReservedBold, fallback.toneReservedBold) : fallback.toneReservedBold,
    naturalPhrases: listField(body, "naturalPhrases", fallback.naturalPhrases),
    bannedVocabulary: listField(body, "bannedVocabulary", fallback.bannedVocabulary),
    primaryContentGoal: stringField(body, "primaryContentGoal", fallback.primaryContentGoal),
    ctaStyle: stringField(body, "ctaStyle", fallback.ctaStyle),
    approvedTopics: listField(body, "approvedTopics", fallback.approvedTopics),
    offLimitsTopics: listField(body, "offLimitsTopics", fallback.offLimitsTopics),
    strongOpinions: stringField(body, "strongOpinions", fallback.strongOpinions),
    writingSamples: listField(body, "writingSamples", fallback.writingSamples).slice(0, 3),
    faceReferenceFileName: stringField(body, "faceReferenceFileName", fallback.faceReferenceFileName),
    voiceSampleFileName: stringField(body, "voiceSampleFileName", fallback.voiceSampleFileName),
    allowAiFace: boolField(body, "allowAiFace", fallback.allowAiFace),
    allowAiVoice: boolField(body, "allowAiVoice", fallback.allowAiVoice),
    autoAiDisclosure: boolField(body, "autoAiDisclosure", fallback.autoAiDisclosure),
    sourceUrls: {
      linkedin: stringField(body, "linkedinUrl", fallback.sourceUrls.linkedin),
      website: stringField(body, "websiteUrl", fallback.sourceUrls.website),
      instagram: stringField(body, "instagramUrl", fallback.sourceUrls.instagram),
      x: stringField(body, "xUrl", fallback.sourceUrls.x)
    },
    updatedAt: new Date().toISOString()
  };
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

function normalizeGenerationAspectRatio(generationType: "video" | "image" | "text", value: unknown) {
  const ratio = String(value || "").trim();
  if (generationType === "video") return ratio === "16:9" ? "16:9" : "9:16";
  if (generationType === "image") return ["1:1", "4:5", "16:9", "9:16"].includes(ratio) ? ratio : "4:5";
  return "";
}

const contentPlanFormats = [
  "Short video 9:16",
  "Long-form video 16:9",
  "Image 1:1",
  "Image 4:5",
  "Image 16:9",
  "Image 9:16",
  "Text post",
  "Long-form article"
];

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
  const body = await req.json() as Record<string, unknown>;
  const action = body.action as string;
  const workspaceId = user.workspaceId;
  await debugLog(workspaceId, {
    action,
    label: `Action requested: ${action}`,
    status: "started",
    provider: "system",
    prompt: typeof body.prompt === "string" ? body.prompt : typeof body.videoPrompt === "string" ? body.videoPrompt : undefined,
    details: summarizePayload(body)
  });

  if (action === "refreshTrends") {
    try {
      const dbResult = await mutateDb(async (db) => {
        const workspace = db.workspaces.find((item) => item.id === workspaceId);
        const signals = await fetchTrendSignals(workspace?.niche?.trim() || "social media content");
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
        const isMarketTask = generationModel === "seedance-2.0" || isKieImageModel(generationModel) || asset.providerTaskId.startsWith("task_");
        if (isMarketTask) {
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
            db.activity.push({ id: id("act"), workspaceId, message: `Kie ${asset.type === "video" || asset.type === "ugc" ? "video" : "image"} ready for "${asset.title}".`, createdAt: new Date().toISOString() });
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

  if (action === "auditConnectedSocials") {
    const accounts = (await getConnectedUploadPostAccounts()).filter((account) => !account.reauthRequired);
    if (accounts.length === 0) return NextResponse.json({ audits: [], connectedAccounts: [] });
    const audits = [];
    for (const account of accounts) {
      const platform = account.platform as Platform;
      let normalized: Omit<CompetitorResult, "id" | "workspaceId" | "competitorId" | "platform" | "capturedAt">[];
      let source: "apify" | "fallback" = "apify";
      let error = "";
      try {
        const apifyItems = await scanSocialUrl(account.url, 0);
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
        error = err instanceof Error ? err.message : "Apify connected-account audit failed";
        normalized = mockCompetitorResults({ workspaceId, competitorId: "audit", platform, url: account.url, minViews: 0 }).map((item) => ({
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
          url: account.url,
          platform,
          handle: account.handle,
          authorityScore,
          avgViews,
          avgLikes,
          postsAnalysed,
          topResultIds: results.slice(0, 5).map((item) => item.id),
          createdAt: new Date().toISOString(),
          source,
          error
        };
        db.socialAudits = db.socialAudits.filter((item) => !(item.workspaceId === workspaceId && item.platform === platform && item.handle === account.handle));
        db.socialAudits.push(created);
        db.socialAudits = db.socialAudits.filter((item) => item.workspaceId !== workspaceId).concat(db.socialAudits.filter((item) => item.workspaceId === workspaceId).slice(-10));
        db.activity.push({ id: id("act"), workspaceId, message: `Connected social audit completed for ${account.displayName} on ${platform} using ${source}.`, createdAt: new Date().toISOString() });
        return created;
      });
      audits.push(audit);
    }
    return NextResponse.json({ audits, connectedAccounts: accounts });
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
    const workspace = await mutateDb((db) => db.workspaces.find((item) => item.id === workspaceId) || null);
    const niche = workspace?.niche?.trim() || "";
    if (!result) return NextResponse.json({ error: "Research result not found" }, { status: 404 });
    const sourceTitle = String(body.sourceTitle || "");
    const sourceUrl = String(body.sourceUrl || "");
    if ((sourceTitle && sourceTitle !== result.title) || (sourceUrl && sourceUrl !== result.url)) {
      return NextResponse.json({ error: "Selected research result changed before the plan could be created. Please click Create plan on the result again." }, { status: 409 });
    }
    const geminiPrompt = buildContentPlanPrompt({ ...result, niche });
    await debugLog(workspaceId, {
      action,
      label: `Prompt sent to Gemini for research result: ${result.title}`,
      status: "started",
      provider: "kie",
      prompt: geminiPrompt,
      details: { model: "gemini-3.5-flash", resultId: result.id, sourceUrl: result.url, platform: result.platform }
    });
    let plan;
    try {
      plan = await generateContentPlanWithGemini({ ...result, niche }, geminiPrompt);
      await debugLog(workspaceId, {
        action,
        label: `Gemini content plan returned for: ${result.title}`,
        status: "success",
        provider: "kie",
        details: { model: "gemini-3.5-flash", topic: String(plan.topic || ""), format: String(plan.format || "") }
      });
    } catch (error) {
      await debugLog(workspaceId, {
        action,
        label: `Gemini content plan failed; local fallback used for: ${result.title}`,
        status: "failed",
        provider: "kie",
        prompt: geminiPrompt,
        error: error instanceof Error ? error.message : "Gemini content plan failed"
      });
      const context = niche || "the selected brand";
      plan = {
        topic: `Turn "${result.title}" into a content lesson`,
        format: result.platform === "LinkedIn" || result.platform === "X" ? "Text post" : "Short video 9:16",
        platforms: [result.platform],
        description: `Recreate the winning angle from "${result.title}" for ${context}.`,
        videoPrompt: `Vertical founder-led social video about ${result.title}. Open with a clear pain point, show a practical example for ${context}, use clean visuals, add concise text overlays, and end with a practical CTA.`,
        duration: 8,
        hooks: [
          "Most audiences miss the simple lesson behind this.",
          "This post worked because it made the idea concrete.",
          "Here is how I would rebuild this angle for the brand."
        ],
        outline: ["Open with the core tension", "Show the source angle", "Give a brand-relevant example", "End with a practical CTA"],
        shotList: ["Hook to camera", "Problem visual", "Brand-relevant example", "CTA close-up with branded caption"],
        creativeNotes: "Keep pacing practical and direct. Use clear captions, specific examples, and a clean visual style.",
        caption: `This angle works because it makes the topic concrete for ${context}.`,
        hashtags: ["#ContentStrategy", "#SocialMedia", "#Creator"],
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
      await debugLog(workspaceId, {
        action,
        label: `Publish payload sent to Upload-Post: ${snapshot.item.title}`,
        status: "started",
        provider: "upload-post",
        prompt: description,
        details: { publishId: snapshot.item.id, platform: snapshot.item.platform, hasAssetUrl: Boolean(snapshot.asset?.assetUrl) }
      });
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
      await debugLog(workspaceId, {
        action,
        label: `Upload-Post accepted: ${snapshot.item.title}`,
        status: "success",
        provider: "upload-post",
        details: { requestId: result.request_id, platform: snapshot.item.platform }
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
      await debugLog(workspaceId, {
        action,
        label: "Upload-Post publish failed",
        status: "failed",
        provider: "upload-post",
        error: error instanceof Error ? error.message : "Upload-Post publish failed"
      });
      return NextResponse.json(updated || { error: "Publish failed" }, { status: 502 });
    }
  }

  if (action === "generateBriefWithAi") {
    const idea = String(body.idea || "").trim();
    if (!idea) return NextResponse.json({ error: "Tell me what you want to create first." }, { status: 400 });
    const requestedFormatRaw = String(body.requestedFormat || "").trim();
    const requestedFormat = contentPlanFormats.includes(requestedFormatRaw) ? requestedFormatRaw : "";
    const workspace = await mutateDb((db) => db.workspaces.find((item) => item.id === workspaceId) || null);
    const niche = workspace?.niche?.trim() || "";
    const prompt = buildAiBriefPrompt({ idea, niche, requestedFormat });
    await debugLog(workspaceId, {
      action,
      label: "Prompt sent to Kie GPT-5.5 for new content plan",
      status: "started",
      provider: "kie",
      prompt,
      details: { model: "gpt-5-5", idea, requestedFormat: requestedFormat || undefined }
    });
    try {
      const plan = await generateContentPlanWithGpt55({ idea, niche, requestedFormat }, prompt);
      const format = requestedFormat || String(plan.format || "Short video 9:16");
      const resolvedFormat = contentPlanFormats.includes(format) ? format : "Short video 9:16";
      const resolvedKind = contentKindFromFormat(resolvedFormat);
      const draft = {
        topic: String(plan.topic || idea),
        format: resolvedFormat,
        description: String(plan.description || ""),
        videoPrompt: String(plan.videoPrompt || ""),
        duration: resolvedKind === "video" ? Number(plan.duration || defaultDuration(resolvedFormat) || 0) || defaultDuration(resolvedFormat) || "" : "",
        hooks: Array.isArray(plan.hooks) ? plan.hooks.join("\n") : String(plan.hooks || ""),
        outline: Array.isArray(plan.outline) ? plan.outline.join("\n") : String(plan.outline || ""),
        shotList: Array.isArray(plan.shotList) ? plan.shotList.join("\n") : String(plan.shotList || ""),
        creativeNotes: String(plan.creativeNotes || ""),
        caption: String(plan.caption || ""),
        hashtags: Array.isArray(plan.hashtags) ? plan.hashtags.join(", ") : String(plan.hashtags || ""),
        optimalTime: String(plan.optimalTime || "Thu 10:00 AM"),
        expectedPerformance: String(plan.expectedPerformance || "4.0-5.5% engagement")
      };
      await debugLog(workspaceId, {
        action,
        label: `Kie GPT-5.5 populated new content plan: ${draft.topic}`,
        status: "success",
        provider: "kie",
        details: { model: "gpt-5-5", format: draft.format, topic: draft.topic }
      });
      return NextResponse.json(draft);
    } catch (error) {
      await debugLog(workspaceId, {
        action,
        label: "Kie GPT-5.5 content plan generation failed",
        status: "failed",
        provider: "kie",
        prompt,
        error: error instanceof Error ? error.message : "Kie GPT-5.5 generation failed"
      });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Kie GPT-5.5 generation failed" }, { status: 502 });
    }
  }

  if (action === "startAssetGeneration") {
    const assetId = String(body.id || "");
    const snapshot = await mutateDb((db) => {
      const asset = db.assets.find((item) => item.id === assetId && item.workspaceId === workspaceId);
      if (!asset) throw new Error("Asset not found.");
      if (asset.provider !== "kie") throw new Error("Asset is not a Kie generation.");
      if (asset.providerTaskId) return { asset, alreadyStarted: true };
      const publishItem = db.publishQueue.find((item) => item.assetId === asset.id && item.workspaceId === workspaceId);
      return { asset, publishItem, alreadyStarted: false };
    });
    if (snapshot.alreadyStarted) return NextResponse.json(snapshot.asset);
    const asset = snapshot.asset;
    const settings = (asset.generationSettings || snapshot.publishItem?.generationSettings || {}) as Record<string, unknown>;
    const model = asset.generationModel || String(body.generationModel || "veo-fast");
    const prompt = asset.prompt || asset.title;
    const references = asset.assetReferences || [];
    await debugLog(workspaceId, {
      action,
      label: `Prompt sent to Kie ${model}`,
      status: "started",
      provider: "kie",
      prompt,
      details: {
        assetId: asset.id,
        model,
        duration: settings.duration || snapshot.publishItem?.duration,
        aspectRatio: settings.aspectRatio,
        references
      }
    });
    try {
      const taskId = isKieImageModel(model)
        ? await generateImage(prompt, { model, aspectRatio: String(settings.aspectRatio || ""), references })
        : model === "seedance-2.0"
          ? await generateSeedanceVideo(prompt, { duration: Number(settings.duration || snapshot.publishItem?.duration || 8), aspectRatio: String(settings.aspectRatio || "9:16"), references })
          : await generateVeoVideo(prompt, { duration: Number(settings.duration || snapshot.publishItem?.duration || 8), aspectRatio: String(settings.aspectRatio || "9:16"), references });
      const updated = await mutateDb((db) => {
        const existing = db.assets.find((item) => item.id === asset.id && item.workspaceId === workspaceId);
        if (!existing) return asset;
        existing.status = "rendering";
        existing.progress = 35;
        existing.providerTaskId = taskId;
        existing.generationModel = model;
        db.publishQueue
          .filter((item) => item.assetId === existing.id && item.workspaceId === workspaceId)
          .forEach((item) => {
            item.status = "generating";
            item.providerRequestId = taskId;
          });
        db.activity.push({ id: id("act"), workspaceId, message: `Kie task started: ${taskId}`, createdAt: new Date().toISOString() });
        return existing;
      });
      await debugLog(workspaceId, {
        action,
        label: `Kie task started: ${taskId}`,
        status: "success",
        provider: "kie",
        prompt,
        details: { assetId: asset.id, model, taskId }
      });
      return NextResponse.json(updated);
    } catch (error) {
      const updated = await mutateDb((db) => {
        const existing = db.assets.find((item) => item.id === asset.id && item.workspaceId === workspaceId);
        if (!existing) return asset;
        existing.status = "failed";
        existing.error = error instanceof Error ? error.message : "Kie generation failed";
        db.publishQueue
          .filter((item) => item.assetId === existing.id && item.workspaceId === workspaceId)
          .forEach((item) => {
            item.status = "failed";
            item.error = existing.error;
          });
        return existing;
      });
      await debugLog(workspaceId, {
        action,
        label: `Kie generation failed for: ${asset.title}`,
        status: "failed",
        provider: "kie",
        prompt,
        error: error instanceof Error ? error.message : "Kie generation failed"
      });
      return NextResponse.json(updated, { status: 502 });
    }
  }

  const data = await mutateDb((db) => {
    const activity = (message: string) => db.activity.push({ id: id("act"), workspaceId, message, createdAt: new Date().toISOString() });

    if (action === "clearWorkspaceHistory") {
      if (String(body.confirm || "") !== "DELETE_CURRENT_HISTORY") throw new Error("Missing clear-history confirmation.");
      db.briefs = db.briefs.filter((item) => item.workspaceId !== workspaceId);
      db.assets = db.assets.filter((item) => item.workspaceId !== workspaceId);
      db.publishQueue = db.publishQueue.filter((item) => item.workspaceId !== workspaceId);
      db.socialAudits = (db.socialAudits || []).filter((item) => item.workspaceId !== workspaceId);
      db.researchScans = (db.researchScans || []).filter((item) => item.workspaceId !== workspaceId);
      db.competitorResults = (db.competitorResults || []).filter((item) => item.workspaceId !== workspaceId || item.competitorId === "seed");
      db.activity = db.activity.filter((item) => item.workspaceId !== workspaceId);
      activity("Cleared current generated asset, publish, content plan, research, and social audit history.");
      return {
        briefs: 0,
        assets: 0,
        publishQueue: 0,
        socialAudits: 0,
        researchScans: 0
      };
    }

    if (action === "updateWorkspace") {
      const workspace = db.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return null;
      workspace.name = String(body.name || workspace.name).trim() || workspace.name;
      if (Object.prototype.hasOwnProperty.call(body, "niche")) workspace.niche = String(body.niche || "").trim();
      activity(`Workspace context updated: ${workspace.niche || "No brand/niche set"}`);
      return workspace;
    }

    if (action === "updatePersonaProfile") {
      db.personaProfiles ||= [];
      const existingIndex = db.personaProfiles.findIndex((item) => item.workspaceId === workspaceId);
      const previous = existingIndex >= 0 ? db.personaProfiles[existingIndex] : undefined;
      const profile = personaFromBody(workspaceId, body, previous);
      if (existingIndex >= 0) db.personaProfiles[existingIndex] = profile;
      else db.personaProfiles.push(profile);
      activity(`Persona profile saved: ${profile.fullName || profile.preferredName || "Unnamed persona"}`);
      return profile;
    }

    if (action === "addCompetitor") {
      const url = String(body.url || body.handle || "");
      const minViews = Number(body.minViews || 0);
      const platform = url ? platformFromUrl(url) : (body.platform as Platform);
      const cadence: "daily" | "weekly" = body.cadence === "daily" ? "daily" : "weekly";
      const item = { id: id("cmp"), workspaceId, platform, handle: handleFromUrl(url || String(body.handle || "")), url, minViews, cadence, lastScraped: new Date().toISOString() };
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

    if (action === "createBrief") {
      const format = String(body.format || "Short video 9:16");
      const topic = String(body.topic || "Untitled content plan").trim() || "Untitled content plan";
      const now = new Date().toISOString();
      const brief: Brief = {
        id: id("brf"),
        workspaceId,
        topic,
        format,
        platforms: [contentKindFromFormat(format) === "text" ? "LinkedIn" : contentKindFromFormat(format) === "image" ? "Instagram" : "TikTok"],
        description: String(body.description || ""),
        videoPrompt: String(body.videoPrompt || ""),
        duration: Number(body.duration || 0) || defaultDuration(format),
        hooks: parseList(body.hooks),
        outline: parseList(body.outline),
        shotList: parseList(body.shotList),
        creativeNotes: String(body.creativeNotes || ""),
        caption: String(body.caption || ""),
        hashtags: parseList(body.hashtags),
        optimalTime: String(body.optimalTime || ""),
        expectedPerformance: String(body.expectedPerformance || ""),
        analysisSummary: "Created manually.",
        createdAt: now,
        updatedAt: now,
        status: "new"
      };
      db.briefs.push(brief);
      activity(`Created content plan: ${brief.topic}`);
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
      const model = String(body.generationModel || (generationType === "video" ? "veo-fast" : generationType === "image" ? "gpt-image-2" : "gemini-3.5-flash"));
      const duration = Number(body.duration || brief.duration || defaultDuration(brief.format) || 0) || undefined;
      const assetReferences = parseAssetReferences(body.assetReferences);
      const prompt = enrichPromptWithAssetReferences(String(body.prompt || defaultPromptForBrief(brief, generationType)), generationType, assetReferences);
      const caption = String(body.caption || defaultCaptionForBrief(brief));
      const hashtags = parseList(body.hashtags || defaultHashtagsForBrief(brief, generationType).join(", "));
      const platform = (String(body.platform || brief.platforms[0] || "TikTok") as Platform);
      const generationSettings = {
        aspectRatio: normalizeGenerationAspectRatio(generationType, body.aspectRatio),
        variants: String(body.variants || ""),
        tone: String(body.tone || ""),
        length: String(body.length || ""),
        duration
      };
      const now = new Date().toISOString();
      const type: Asset["type"] = generationType === "video" ? "video" : generationType === "image" ? "image" : "text";
      const isKieVideo = generationType === "video" && (model === "veo-fast" || model === "seedance-2.0");
      const isKieImage = generationType === "image" && isKieImageModel(model);
      const isKieGeneration = isKieVideo || isKieImage;
      brief.duration = duration || brief.duration;
      brief.status = "production";
      brief.updatedAt = now;
      const asset: Asset = {
        id: id("ast"),
        workspaceId,
        briefId: brief.id,
        title: brief.topic,
        type,
        status: isKieGeneration ? "queued" : "ready",
        progress: isKieGeneration ? 10 : 100,
        createdAt: now,
        provider: isKieGeneration ? "kie" : "local",
        generationModel: model,
        generationSettings,
        prompt,
        assetReferences,
        assetUrl: isKieGeneration ? undefined : generationType === "video" ? demoVideoUrl : generationType === "text" ? `data:text/plain;charset=utf-8,${encodeURIComponent(`${caption}\n\n${hashtags.join(" ")}`)}` : undefined
      };
      db.assets.push(asset);
      const item: PublishItem = {
        id: id("pub"),
        workspaceId,
        assetId: asset.id,
        title: brief.topic,
        platform,
        scheduledAt: now,
        status: isKieGeneration ? "generating" : "done",
        provider: isKieGeneration ? "kie" : "local",
        caption,
        hashtags,
        generationModel: model,
        generationType,
        generationSettings,
        duration,
        prompt,
        assetReferences,
        assetUrl: asset.assetUrl,
        createdAt: now
      };
      db.publishQueue.push(item);
      const ws = db.workspaces.find((entry) => entry.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (generationType === "video" ? 8 : generationType === "image" ? 3 : 1));
      activity(isKieGeneration ? `Queued ${model} generation for "${brief.topic}".` : `Generated ${model} draft for "${brief.topic}".`);
      return { asset, publishItem: item };
    }

    if (action === "generateDirectContent") {
      const generationType = (String(body.generationType || "video") as "video" | "image" | "text");
      const model = String(body.generationModel || (generationType === "video" ? "veo-fast" : generationType === "image" ? "gpt-image-2" : "gemini-3.5-flash"));
      const duration = Number(body.duration || 0) || (generationType === "video" ? 8 : undefined);
      const assetReferences = parseAssetReferences(body.assetReferences);
      const workspace = db.workspaces.find((entry) => entry.id === workspaceId);
      const context = workspace?.niche?.trim() || "the configured brand";
      const prompt = enrichPromptWithAssetReferences(String(body.prompt || `Create a practical founder-led social post for ${context}.`), generationType, assetReferences);
      const caption = String(body.caption || "A practical reminder for SME teams: automate repeatable work first.");
      const hashtags = parseList(body.hashtags || "#SME, #Automation, #AI");
      const platform = (String(body.platform || "TikTok") as Platform);
      const generationSettings = {
        aspectRatio: normalizeGenerationAspectRatio(generationType, body.aspectRatio),
        variants: String(body.variants || ""),
        tone: String(body.tone || ""),
        length: String(body.length || ""),
        duration
      };
      const now = new Date().toISOString();
      const title = prompt.split(/\n|\.|\?/)[0].slice(0, 96) || "Direct content draft";
      const type: Asset["type"] = generationType === "video" ? "video" : generationType === "image" ? "image" : "text";
      const isKieVideo = generationType === "video" && (model === "veo-fast" || model === "seedance-2.0");
      const isKieImage = generationType === "image" && isKieImageModel(model);
      const isKieGeneration = isKieVideo || isKieImage;
      const asset: Asset = {
        id: id("ast"),
        workspaceId,
        briefId: "direct",
        title,
        type,
        status: isKieGeneration ? "queued" : "ready",
        progress: isKieGeneration ? 10 : 100,
        createdAt: now,
        provider: isKieGeneration ? "kie" : "local",
        generationModel: model,
        generationSettings,
        prompt,
        assetReferences,
        assetUrl: isKieGeneration ? undefined : generationType === "video" ? demoVideoUrl : generationType === "text" ? `data:text/plain;charset=utf-8,${encodeURIComponent(`${caption}\n\n${hashtags.join(" ")}`)}` : undefined
      };
      db.assets.push(asset);
      const item: PublishItem = {
        id: id("pub"),
        workspaceId,
        assetId: asset.id,
        title,
        platform,
        scheduledAt: now,
        status: isKieGeneration ? "generating" : "done",
        provider: isKieGeneration ? "kie" : "local",
        caption,
        hashtags,
        generationModel: model,
        generationType,
        generationSettings,
        duration,
        prompt,
        assetReferences,
        assetUrl: asset.assetUrl,
        createdAt: now
      };
      db.publishQueue.push(item);
      const ws = db.workspaces.find((entry) => entry.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (generationType === "video" ? 8 : generationType === "image" ? 3 : 1));
      activity(isKieGeneration ? `Queued ${model} direct generation.` : `Generated ${model} direct draft.`);
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
      const item: PublishItem = { id: id("pub"), workspaceId, assetId: asset.id, title: asset.title, platform: body.platform as Platform, scheduledAt: String(body.scheduledAt || new Date(Date.now() + 86400000).toISOString()), status: "scheduled" };
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
  if (action === "generateDraftFromPlan" || action === "generateDirectContent" || action === "renderAsset" || action === "generateUgc") {
    await debugLog(workspaceId, {
      action,
      label: `Generation asset created: ${generatedAsset?.title || action}`,
      status: "success",
      provider: generatedAsset?.provider || "local",
      prompt: generatedAsset?.prompt,
      details: {
        assetId: generatedAsset?.id,
        type: generatedAsset?.type,
        model: generatedAsset?.generationModel,
        referenceCount: generatedAsset?.assetReferences?.length || 0,
        status: generatedAsset?.status
      }
    });
  }
  if ((action === "renderAsset" || action === "generateUgc") && generatedAsset?.provider === "kie") {
    try {
      const model = generatedAsset.generationModel || String(body.generationModel || "veo-fast");
      const prompt = generatedAsset.prompt || generatedAsset.title;
      const references = generatedAsset.assetReferences || parseAssetReferences(body.assetReferences);
      await debugLog(workspaceId, {
        action,
        label: `Prompt sent to Kie ${model}`,
        status: "started",
        provider: "kie",
        prompt,
        details: {
          assetId: generatedAsset.id,
          model,
          duration: body.duration,
          aspectRatio: body.aspectRatio,
          references
        }
      });
      const taskId = isKieImageModel(model)
        ? await generateImage(prompt, { model, aspectRatio: String(body.aspectRatio || ""), references })
        : model === "seedance-2.0"
          ? await generateSeedanceVideo(prompt, { duration: Number(body.duration || 8), aspectRatio: String(body.aspectRatio || "9:16"), references })
          : await generateVeoVideo(prompt, { duration: Number(body.duration || 8), aspectRatio: String(body.aspectRatio || "9:16"), references });
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
        return asset;
      });
      await debugLog(workspaceId, {
        action,
        label: `Kie task started: ${taskId}`,
        status: "success",
        provider: "kie",
        prompt,
        details: { assetId: generatedAsset.id, model, taskId }
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
      await debugLog(workspaceId, {
        action,
        label: `Kie generation failed for: ${generatedAsset.title}`,
        status: "failed",
        provider: "kie",
        prompt: generatedAsset.prompt,
        error: error instanceof Error ? error.message : "Kie generation failed"
      });
      return NextResponse.json(updated, { status: 502 });
    }
  }

  return NextResponse.json(data);
}
