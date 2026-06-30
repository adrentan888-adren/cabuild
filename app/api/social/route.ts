import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { defaultPersonaProfile, id, mutateDb } from "@/lib/store";
import type { Asset, Brief, CompetitorResult, GenerationAssetReference, PersonaProfile, Platform, PublishItem, ResearchScan } from "@/lib/types";
import { appendPersonaContext, buildPersonaContext, normalizePersonaProfile } from "@/lib/persona";
import { completeKeywordScanRun, completeSocialUrlScanRun, crawlPersonaSourcesWithApify, fetchTrendSignals, scanKeywordsWithApify, scanSocialUrl, startKeywordScanRun, startSocialUrlScanRun } from "@/lib/providers/apify";
import { buildAiBriefPrompt, buildContentPlanPrompt, buildFinalVideoPromptInstruction, generateContentPlanWithGemini, generateContentPlanWithGpt55, generateFinalVideoPromptWithGpt55, generateImage, generatePersonaAutofillWithGpt55, generateSeedanceVideo, generateVeoVideo, getMarketTask, getVeoVideo } from "@/lib/providers/kie";
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
  const audioRef = refs.find((ref) => ref.role === "audio");
  const refLabel = (ref: GenerationAssetReference) => `"${ref.fileName}"${ref.url ? ` at ${ref.url}` : ""}`;
  const lines = [
    productRef ? `- Product photo reference ${refLabel(productRef)}: include the product/photo visibly as a main visual element. Preserve important details and integrate it naturally.` : "",
    avatarRef ? `- Avatar/persona reference ${refLabel(avatarRef)}: use this as the on-screen person/creator/persona reference and keep it recognizable.` : "",
    logoRef ? `- Logo reference ${refLabel(logoRef)}: include this exact brand logo clearly in the ${mediaLabel}. Do not replace it with generic text or an invented logo.` : "",
    audioRef && generationType === "video" ? `- Audio reference ${refLabel(audioRef)}: use this only as user-approved audio direction. Replace the source video's original audio with a new safe audio/voice style based on this reference when supported; otherwise describe the intended audio in the prompt.` : ""
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

function videoPromptSceneCount(duration: number) {
  if (duration <= 6) return "2 tight scenes maximum";
  if (duration <= 10) return "3 to 4 scenes maximum";
  return "4 to 5 scenes maximum";
}

function enhanceVideoPromptForProvider(input: {
  prompt: string;
  model: string;
  duration?: number;
  aspectRatio?: string;
  references?: GenerationAssetReference[];
}) {
  if (input.model !== "seedance-2.0" && input.model !== "veo-fast") return input.prompt;
  if (input.prompt.includes("Provider-specific video prompt guidance")) return input.prompt;
  const duration = Math.max(4, Math.min(15, Math.round(Number(input.duration || 8))));
  const aspectRatio = input.aspectRatio === "16:9" ? "16:9 landscape" : "9:16 vertical";
  const provider = input.model === "seedance-2.0" ? "Seedance 2.0" : "VEO Fast";
  const refs = input.references || [];
  const refRoles = refs.length
    ? refs.map((ref, index) => `- Reference ${index + 1} (${ref.role}, ${ref.fileName}${ref.url ? `, URL: ${ref.url}` : ""}): use only for its stated role; keep logos/products visually clear and avoid inventing replacement branding.${ref.role === "logo" ? " This is the exact logo image; reproduce this logo, not a placeholder or generic wordmark." : ""}${ref.role === "audio" ? " This is an audio direction/reference; do not send it as visual branding, use it only for audio/voice style guidance if supported." : ""}`).join("\n")
    : "- No uploaded visual references are attached.";
  const seedanceSpecific = input.model === "seedance-2.0"
    ? [
      "Seedance-specific requirements:",
      "- Use clear timed scene segments and physically plausible motion.",
      "- Include audio direction because Seedance can generate BGM and sound effects.",
      "- If references are attached, treat them as role-based reference images rather than generic inspiration.",
      "- Do not overload short durations; every segment must be renderable in the selected duration."
    ].join("\n")
    : [
      "VEO-specific requirements:",
      "- Use clean natural-language scene direction with camera movement and pacing.",
      "- Keep text overlay requests short and legible; avoid asking for too many readable text elements.",
      "- Make the opening shot visually strong, then resolve into a clear CTA/end frame."
    ].join("\n");

  return [
    input.prompt.trim(),
    "Provider-specific video prompt guidance:",
    `Target model: ${provider}.`,
    `Target duration: ${duration} seconds.`,
    `Target aspect ratio: ${aspectRatio}.`,
    `Prompt complexity: ${videoPromptSceneCount(duration)}.`,
    "",
    "Rewrite/interpret the video as a structured social ad:",
    "- 0-3s: thumb-stopping hook with a clear visual problem, bold motion, and immediate attention cue.",
    `- 3-${Math.max(4, duration - 2)}s: main value/USP scenes with specific actions, camera movement, transitions, and readable mobile text overlays.`,
    `- ${Math.max(4, duration - 2)}-${duration}s: brand/CTA ending with logo or company name, concise call to action, and compliance-safe wording.`,
    "- Specify shot sizes and camera movements such as close-up, medium shot, push in, pan, track, orbit, or whip pan where useful.",
    "- Include sound design: music mood, notification hits, transition sounds, voiceover or text-only direction.",
    "- Maintain high-conversion social media pacing, professional lighting, and strong mobile readability.",
    "- Avoid unrealistic financial claims, guaranteed approval, cash piles, luxury promises, or misleading before/after outcomes.",
    "",
    "Uploaded reference roles:",
    refRoles,
    refs.some((ref) => ref.role === "logo")
      ? "Logo enforcement: the uploaded logo reference is the brand mark. Include that exact logo in the first or final frame with enough contrast, stroke, shadow, or clean background separation. Do not replace it with generic text or invented symbols."
      : "",
    refs.some((ref) => ref.role === "product photo")
      ? "Product reference enforcement: use the uploaded product/photo reference as the visual product cue. Do not substitute unrelated products."
      : "",
    refs.some((ref) => ref.role === "avatar/persona")
      ? "Avatar/persona enforcement: use the uploaded persona reference only for character/person appearance, not for branding."
      : "",
    refs.some((ref) => ref.role === "audio")
      ? "Audio reference enforcement: replace the original source audio. If the provider cannot clone or use the uploaded audio directly, create a new royalty-safe voice/music/sound direction inspired by the uploaded audio reference metadata and prompt notes."
      : "",
    "",
    seedanceSpecific
  ].filter(Boolean).join("\n");
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
    contentType: String(dimensions.contentType || ""),
    uploadDate: String(dimensions.uploadDate || "")
  };
}

function parseList(value: unknown) {
  return String(value || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
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

function cleanAutofillValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.trim();
  return value;
}

function compactAutofillOutput(generated: Record<string, unknown>) {
  const listKeys = new Set(["naturalPhrases", "bannedVocabulary", "approvedTopics", "offLimitsTopics", "writingSamples"]);
  return Object.fromEntries(
    Object.entries(generated)
      .map(([key, value]): [string, unknown] => [key, cleanAutofillValue(value)])
      .filter(([key, value]) => Array.isArray(value) ? listKeys.has(key) || value.length > 0 : typeof value === "string" ? value.length > 0 : value !== undefined && value !== null)
  );
}

function providerErrorFromJson(value: Record<string, unknown>) {
  const code = value.code || value.statusCode || value.status;
  const message = String(value.msg || value.message || value.error || "");
  return (typeof code === "number" && code >= 400) || /server exception|failed|error/i.test(message) ? message || `Provider returned ${code}` : "";
}

function titleCaseFromSlug(value: string) {
  const parts = value
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)
    .filter(Boolean);
  const inIndex = parts.indexOf("in");
  return inIndex >= 0 ? parts[inIndex + 1] || "" : parts[1] || "";
}

function nameFromProfileUrl(url: string) {
  let slug = titleCaseFromSlug(url)
    .replace(/^in\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\d+/g, "")
    .trim();
  if (slug && !slug.includes(" ")) {
    const commonFirstNames = ["gregory", "charles", "sean", "mariana", "maria", "john", "david", "michael", "sarah", "james"];
    const lowerSlug = slug.toLowerCase();
    const splitName = commonFirstNames.find((name) => lowerSlug.startsWith(name) && lowerSlug.length > name.length + 2);
    if (splitName) slug = `${lowerSlug.slice(0, splitName.length)} ${lowerSlug.slice(splitName.length)}`;
  }
  return slug.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function firstUsefulLine(textValue: string) {
  return textValue
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^https?:\/\//i.test(line) && !/read more/i.test(line))[0] || "";
}

function cleanSnippetText(value: string) {
  return value
    .replace(/\.\.\./g, "")
    .replace(/Read more/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPersonaRole(value: string) {
  return value
    .replace(/\s*[|,&/-]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactNameKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanPersonaName(value: string) {
  const trimmed = value.trim();
  if (/^gregorycharles$/i.test(trimmed)) return "Gregory Charles";
  return trimmed;
}

function fallbackPersonaFromCrawl(current: PersonaProfile, crawled: Awaited<ReturnType<typeof crawlPersonaSourcesWithApify>>) {
  const linkedin = crawled.find((item) => item.source === "linkedin");
  const facebook = crawled.find((item) => item.source === "facebook");
  const linkedinFirst = cleanSnippetText(firstUsefulLine(linkedin?.text || ""));
  const facebookFirst = cleanSnippetText(firstUsefulLine(facebook?.text || ""));
  const sourceName = nameFromProfileUrl(linkedin?.url || "") || nameFromProfileUrl(facebook?.url || "");
  const rawDisplayName = cleanPersonaName((linkedinFirst.match(/^([^-\n|]+)/)?.[1] || sourceName || current.displayName).trim());
  const displayName = sourceName && /\s/.test(current.displayName) && compactNameKey(current.displayName) === compactNameKey(sourceName) ? current.displayName : rawDisplayName;
  const linkedParts = linkedinFirst.split(/\s+-\s+|\s+\|\s+/).map((part) => part.trim()).filter(Boolean);
  const role = cleanPersonaRole(linkedParts.slice(1).join(" | ")) || "Strategic professional and technology leader";
  const companyLine = facebookFirst && !/facebook|mentions|groups/i.test(facebookFirst) ? facebookFirst : current.company;
  const company = companyLine || current.company;
  const professionalText = cleanSnippetText([linkedin?.text, facebook?.text].filter(Boolean).join("\n")).slice(0, 1200);
  const audienceInsight = linkedinFirst
    ? `${displayName}'s public profile indicates expertise in ${role || "professional leadership"}, with content angles around product strategy, technology leadership, and customer engagement.`
    : "Public profile information is limited; use a professional, credibility-led persona until more source URLs are added.";
  return compactAutofillOutput({
    displayName,
    role,
    company,
    companyOneLiner: company ? `${company} public profile and professional presence.` : current.companyOneLiner,
    primaryAudience: "Professional audience connected to product, technology, and customer engagement topics.",
    audienceInsight: professionalText ? audienceInsight : current.audienceInsight,
    contentLanguage: current.contentLanguage || "English only",
    voiceStyle: "Professional, strategic, technology-literate, concise, credible.",
    naturalPhrases: [],
    bannedVocabulary: current.bannedVocabulary,
    approvedTopics: ["Product strategy", "Technology leadership", "Customer engagement"],
    offLimitsTopics: current.offLimitsTopics,
    strongOpinions: "",
    writingSamples: current.writingSamples
  });
}

function personaFromBody(workspaceId: string, body: Record<string, unknown>, previous?: PersonaProfile): PersonaProfile {
  const fallback = normalizePersonaProfile(workspaceId, previous || defaultPersonaProfile(workspaceId));
  return normalizePersonaProfile(workspaceId, {
    ...fallback,
    displayName: stringField(body, "displayName", fallback.displayName),
    role: stringField(body, "role", fallback.role),
    company: stringField(body, "company", fallback.company),
    companyOneLiner: stringField(body, "companyOneLiner", fallback.companyOneLiner),
    primaryAudience: stringField(body, "primaryAudience", fallback.primaryAudience),
    audienceInsight: stringField(body, "audienceInsight", fallback.audienceInsight),
    contentLanguage: stringField(body, "contentLanguage", fallback.contentLanguage),
    voiceStyle: stringField(body, "voiceStyle", fallback.voiceStyle),
    naturalPhrases: listField(body, "naturalPhrases", fallback.naturalPhrases),
    bannedVocabulary: listField(body, "bannedVocabulary", fallback.bannedVocabulary),
    approvedTopics: listField(body, "approvedTopics", fallback.approvedTopics),
    offLimitsTopics: listField(body, "offLimitsTopics", fallback.offLimitsTopics),
    strongOpinions: stringField(body, "strongOpinions", fallback.strongOpinions),
    writingSamples: listField(body, "writingSamples", fallback.writingSamples).slice(0, 3),
    sourceUrls: {
      linkedin: stringField(body, "linkedinUrl", fallback.sourceUrls.linkedin),
      website: stringField(body, "websiteUrl", fallback.sourceUrls.website),
      instagram: stringField(body, "instagramUrl", fallback.sourceUrls.instagram),
      facebook: stringField(body, "facebookUrl", fallback.sourceUrls.facebook || ""),
      x: stringField(body, "xUrl", fallback.sourceUrls.x)
    },
    updatedAt: new Date().toISOString()
  });
}

function buildPersonaAutofillPrompt(input: { current: PersonaProfile; crawled: Awaited<ReturnType<typeof crawlPersonaSourcesWithApify>> }) {
  return `You are ContentAgent's persona researcher. Use the crawled public profile/page information to fill a creator/founder persona profile.

Rules:
- Return ONLY valid JSON.
- The public source URLs are the authority for this autofill. Replace the existing persona when the crawl identifies a different person, company, role, audience, or voice.
- Only infer fields when supported by crawled information or very strong contextual signals from the public snippets.
- Preserve existing values only when the crawled sources do not provide a better value. Do not preserve default placeholders such as Sean, CEO, AI automation, or generic founder language when the public sources identify someone else.
- Do not invent private personal facts.
- Keep values practical for social content generation.
- Use arrays for list fields.
- Populate only the requested public, prompt-useful fields. If unsure, use an empty string or empty array instead of the old default.
- For displayName, prefer the public profile/person name from LinkedIn or Facebook.
- For role/company/companyOneLiner, use the clearest public professional identity from the snippets.

Existing persona:
${JSON.stringify(input.current, null, 2)}

Crawled public source snippets:
${JSON.stringify(input.crawled, null, 2)}

Return this exact JSON shape:
{
  "displayName": "",
  "role": "",
  "company": "",
  "companyOneLiner": "",
  "primaryAudience": "",
  "audienceInsight": "",
  "contentLanguage": "",
  "voiceStyle": "",
  "naturalPhrases": [],
  "bannedVocabulary": [],
  "approvedTopics": [],
  "offLimitsTopics": [],
  "strongOpinions": "",
  "writingSamples": []
}`;
}

function contentKindFromFormat(format: string): "video" | "image" | "text" {
  const lower = format.toLowerCase();
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok") || lower.includes("youtube")) return "video";
  if (lower.includes("image") || lower.includes("carousel")) return "image";
  return "text";
}

function sourceFormatFromResearchResult(result: Pick<CompetitorResult, "platform" | "mediaType" | "title" | "description">) {
  const text = `${result.title || ""} ${result.description || ""}`.toLowerCase();
  if (result.mediaType === "image" || text.includes("carousel")) return "Image 1:1";
  if (result.mediaType === "video") return result.platform === "YouTube" ? "Long-form video 16:9" : "Short video 9:16";
  if (result.platform === "LinkedIn" || result.platform === "X") return "Text post";
  if (text.includes("image") || text.includes("photo")) return "Image 1:1";
  if (text.includes("video") || text.includes("reel") || text.includes("tiktok")) return result.platform === "YouTube" ? "Long-form video 16:9" : "Short video 9:16";
  return result.platform === "Instagram" || result.platform === "Facebook" ? "Image 1:1" : "Short video 9:16";
}

function platformFromActorSource(value: string): Platform {
  return ({
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    facebook: "Facebook",
    linkedin: "LinkedIn"
  } as Record<string, Platform>)[value] || "TikTok";
}

function defaultDuration(format: string) {
  const lower = format.toLowerCase();
  if (lower.includes("long")) return 60;
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok")) return 8;
  return undefined;
}

function durationOptionsForGenerationModel(model: string) {
  if (model === "veo-fast") return [8];
  if (model === "seedance-2.0") return [4, 5, 6, 7, 8, 9, 10, 12, 15];
  return [8];
}

function closestVideoDuration(value: unknown, model: string, fallback = 8) {
  const options = durationOptionsForGenerationModel(model);
  const numeric = Number(value || fallback);
  const target = Number.isFinite(numeric) ? numeric : fallback;
  return options.reduce((best, option) => Math.abs(option - target) < Math.abs(best - target) ? option : best, options[0]);
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

const researchUrlSourceOwnershipFilter = "owner-v2";
const keywordResearchCacheVersion = "kw-v13-keyword-fallback-retry";

const keywordContentTypesByPlatform: Record<string, string[]> = {
  instagram: ["instagram-reels", "instagram-posts"],
  tiktok: [],
  youtube: [],
  facebook: [],
  linkedin: ["article"]
};

function normalizeKeywordContentType(platform: string, value: string) {
  const legacyMap: Record<string, string> = {
    video: platform === "instagram" ? "instagram-reels" : "",
    "short-video": platform === "instagram" ? "instagram-reels" : "",
    image: platform === "instagram" ? "instagram-posts" : "",
    carousel: platform === "instagram" ? "instagram-posts" : "",
    "text-post": "",
    text: "",
    link: "",
    "long-video": ""
  };
  const normalized = legacyMap[value] || value;
  if (!normalized) return "";
  return (keywordContentTypesByPlatform[platform] || []).includes(normalized) ? normalized : "";
}

function apifyItemsToResearchResults(items: Awaited<ReturnType<typeof scanSocialUrl>>) {
  return items.map((item) => ({
    platform: item.platform,
    url: item.sourceUrl,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    duration: item.duration,
    description: item.description,
    views: item.views,
    likes: item.likes,
    comments: item.comments,
    publishedAt: item.publishedAt
  }));
}

function usableResearchResult(item: { url?: string; title?: string; thumbnailUrl?: string; mediaUrl?: string }) {
  return Boolean((item.url || item.thumbnailUrl || item.mediaUrl) && item.title && item.title !== "Social post 1");
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
    video: "Video",
    image: "Image",
    text: "Text post",
    link: "Link post",
    "text-post": "Text post",
    article: "Long-form article",
    carousel: "Image carousel"
  };
  const platform = platformFromActorSource(input.dimensions.actorSources[0] || "tiktok");
  const typeLabel = sourceLabel[input.dimensions.contentType] || "Content";
  const format = `${sourceLabel[input.dimensions.actorSources[0]] || platform} ${typeLabel}`;
  return [
    {
      id: id("res"),
      workspaceId: input.workspaceId,
      competitorId: input.competitorId,
      platform,
      url: platform === "LinkedIn" ? `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(input.query)}` : platform === "Instagram" ? `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(input.query)}` : platform === "YouTube" ? `https://www.youtube.com/results?search_query=${encodeURIComponent(input.query)}` : platform === "Facebook" ? `https://www.facebook.com/search/posts/?q=${encodeURIComponent(input.query)}` : `https://www.tiktok.com/search?q=${encodeURIComponent(input.query)}`,
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
      platform,
      url: platform === "LinkedIn" ? `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(input.query)}` : platform === "Instagram" ? `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(input.query)}` : platform === "YouTube" ? `https://www.youtube.com/results?search_query=${encodeURIComponent(input.query)}` : platform === "Facebook" ? `https://www.facebook.com/search/posts/?q=${encodeURIComponent(input.query)}` : `https://www.tiktok.com/search?q=${encodeURIComponent(input.query)}`,
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
      platform,
      url: platform === "LinkedIn" ? `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(input.query)}` : platform === "Instagram" ? `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(input.query)}` : platform === "YouTube" ? `https://www.youtube.com/results?search_query=${encodeURIComponent(input.query)}` : platform === "Facebook" ? `https://www.facebook.com/search/posts/?q=${encodeURIComponent(input.query)}` : `https://www.tiktok.com/search?q=${encodeURIComponent(input.query)}`,
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
        mediaUrl: item.mediaUrl,
        mediaType: item.mediaType,
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
          mediaUrl: item.mediaUrl,
          mediaType: item.mediaType,
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
      const hasCurrentOwnershipFilter = existing?.dimensions?.sourceOwnershipFilter === researchUrlSourceOwnershipFilter;
      return existing?.source === "fallback" || !hasCurrentOwnershipFilter ? null : existing || null;
    });
    if (cached) return NextResponse.json(cached);

    let runMeta: Awaited<ReturnType<typeof startSocialUrlScanRun>> | null = null;
    let startError = "";
    try {
      runMeta = await startSocialUrlScanRun(url, minViews);
    } catch (err) {
      startError = err instanceof Error ? err.message : "Apify scan failed to start";
    }

    const scan = await mutateDb((db) => {
      db.researchScans ||= [];
      const created: ResearchScan = {
        id: id("scan"),
        workspaceId,
        url,
        dimensions: { sourceOwnershipFilter: researchUrlSourceOwnershipFilter },
        platform,
        minViews,
        resultIds: [],
        createdAt: new Date().toISOString(),
        source: "apify",
        status: runMeta ? "running" : "failed",
        apifyRunId: runMeta?.runId,
        apifyDatasetId: runMeta?.datasetId,
        apifyActorId: runMeta?.actorId,
        error: startError
      };
      db.researchScans.push(created);
      db.researchScans = db.researchScans.filter((item) => item.workspaceId !== workspaceId).concat(db.researchScans.filter((item) => item.workspaceId === workspaceId).slice(-10));
      db.activity.push({ id: id("act"), workspaceId, message: runMeta ? `Research scan started for ${handleFromUrl(url)} using Apify. You can leave Research and come back later.` : `Research scan failed to start for ${handleFromUrl(url)}.`, createdAt: new Date().toISOString() });
      return created;
    });
    return NextResponse.json(scan);
  }

  if (action === "syncResearchScan") {
    const scanId = String(body.id || "");
    const scan = await mutateDb((db) => (db.researchScans || []).find((item) => item.id === scanId && item.workspaceId === workspaceId) || null);
    if (!scan) return NextResponse.json({ id: scanId, status: "missing", error: "Research scan no longer exists." });
    if (scan.status !== "running") return NextResponse.json(scan);
    if (!scan.apifyRunId || !scan.apifyDatasetId || !scan.apifyActorId) {
      const failed = await mutateDb((db) => {
        const item = db.researchScans.find((entry) => entry.id === scanId && entry.workspaceId === workspaceId)!;
        item.status = "failed";
        item.error = "Research scan is missing Apify run metadata.";
        item.completedAt = new Date().toISOString();
        return item;
      });
      return NextResponse.json(failed);
    }
    try {
      const runMeta = {
        actorId: scan.apifyActorId,
        runId: scan.apifyRunId,
        datasetId: scan.apifyDatasetId,
        source: scan.platform === "Instagram" ? "instagram" : scan.platform === "YouTube" ? "youtube" : scan.platform === "Facebook" ? "facebook" : scan.platform === "LinkedIn" ? "linkedin" : "tiktok",
        fallbackUrl: scan.query ? "" : scan.url,
        minViews: scan.minViews
      } as const;
      let completed = scan.query
        ? await completeKeywordScanRun({ ...runMeta, contentType: scan.dimensions?.contentType || scan.dimensions?.contentTypes?.[0] || "", keywords: scan.query })
        : await completeSocialUrlScanRun(runMeta);
      if (completed.status === "running") return NextResponse.json(scan);
      let completedSource: ResearchScan["source"] = "apify";
      let completedError = "";
      const shouldTryKeywordFallback = Boolean(
        scan.query &&
        (completed.items.length === 0 || (completed.items.length < 3 && ["Instagram", "Facebook", "LinkedIn"].includes(scan.platform)))
      );
      if (shouldTryKeywordFallback) {
        const fallbackItems = await scanKeywordsWithApify(scan.query || "", scan.dimensions || {}, scan.minViews, { skipPlatformActor: true });
        if (fallbackItems.length > completed.items.length) {
          completed = { status: "done" as const, items: fallbackItems };
          completedSource = "fallback";
          completedError = "Platform actor returned too few usable keyword results, so a broader Apify keyword fallback was used.";
        }
      }
      const normalized = apifyItemsToResearchResults(completed.items);
      const updated = await mutateDb((db) => {
        db.competitors ||= [];
        db.competitorResults ||= [];
        db.researchScans ||= [];
        const item = db.researchScans.find((entry) => entry.id === scanId && entry.workspaceId === workspaceId)!;
        const competitor = { id: id("cmp"), workspaceId, platform: scan.platform, handle: handleFromUrl(scan.url), url: scan.url, minViews: scan.minViews, cadence: "weekly" as const, lastScraped: new Date().toISOString() };
        db.competitors.push(competitor);
        const results: CompetitorResult[] = normalized.map((result) => ({
          ...result,
          id: id("res"),
          workspaceId,
          competitorId: competitor.id,
          platform: result.platform || scan.platform,
          capturedAt: new Date().toISOString()
        }));
        db.competitorResults.push(...results);
        item.resultIds = results.map((result) => result.id);
        item.status = "done";
        item.source = completedSource;
        item.completedAt = new Date().toISOString();
        item.error = completedError;
        db.activity.push({ id: id("act"), workspaceId, message: `Research scan completed for ${handleFromUrl(scan.url)} using ${completedSource === "fallback" ? "Apify fallback" : "Apify"}.`, createdAt: new Date().toISOString() });
        return item;
      });
      return NextResponse.json(updated);
    } catch (err) {
      if (scan.query) {
        try {
          const fallbackItems = await scanKeywordsWithApify(scan.query, scan.dimensions || {}, scan.minViews, { skipPlatformActor: true });
          const normalized = apifyItemsToResearchResults(fallbackItems);
          const recovered = await mutateDb((db) => {
            db.competitors ||= [];
            db.competitorResults ||= [];
            db.researchScans ||= [];
            const item = db.researchScans.find((entry) => entry.id === scanId && entry.workspaceId === workspaceId)!;
            const competitor = { id: id("cmp"), workspaceId, platform: scan.platform, handle: scan.query || handleFromUrl(scan.url), url: scan.url, minViews: scan.minViews, cadence: "weekly" as const, lastScraped: new Date().toISOString() };
            db.competitors.push(competitor);
            const results: CompetitorResult[] = normalized.map((result) => ({
              ...result,
              id: id("res"),
              workspaceId,
              competitorId: competitor.id,
              platform: result.platform || scan.platform,
              capturedAt: new Date().toISOString()
            }));
            db.competitorResults.push(...results);
            item.resultIds = results.map((result) => result.id);
            item.status = "done";
            item.source = "fallback";
            item.completedAt = new Date().toISOString();
            const originalError = err instanceof Error ? err.message : "Apify keyword scan failed";
            item.error = `${originalError}; broader Apify keyword fallback used.`;
            db.activity.push({ id: id("act"), workspaceId, message: `Keyword research recovered for "${scan.query}" using Apify fallback.`, createdAt: new Date().toISOString() });
            return item;
          });
          return NextResponse.json(recovered);
        } catch {
          // Keep the original platform actor error below if fallback also fails.
        }
      }
      const failed = await mutateDb((db) => {
        const item = db.researchScans.find((entry) => entry.id === scanId && entry.workspaceId === workspaceId)!;
        item.status = "failed";
        item.error = err instanceof Error ? err.message : "Apify scan failed";
        item.completedAt = new Date().toISOString();
        db.activity.push({ id: id("act"), workspaceId, message: `Research scan failed for ${handleFromUrl(scan.url)}.`, createdAt: new Date().toISOString() });
        return item;
      });
      return NextResponse.json(failed);
    }
  }

  if (action === "scanKeywordResearch") {
    const query = String(body.keywords || "").trim();
    const minViews = Number(body.minViews || 0);
    const dimensions = normalizeDimensions(body.dimensions);
    const selectedSource = dimensions.actorSources[0] || "instagram";
    dimensions.contentType = normalizeKeywordContentType(selectedSource, dimensions.contentType || dimensions.contentTypes[0] || "");
    dimensions.contentTypes = dimensions.contentType ? [dimensions.contentType] : [];
    if (!query) return NextResponse.json({ error: "Keywords are required" }, { status: 400 });
    const cacheKey = `keyword:${query.toLowerCase()}|${JSON.stringify(dimensions)}|min:${minViews}|${keywordResearchCacheVersion}`;
    const cached = await mutateDb((db) => {
      db.researchScans ||= [];
      db.competitorResults ||= [];
      const existing = db.researchScans
        .filter((scan) => scan.workspaceId === workspaceId && scan.url === cacheKey)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (existing?.status === "done") {
        const linked = db.competitorResults.filter((result) => existing.resultIds.includes(result.id));
        if (!linked.some(usableResearchResult)) return null;
      }
      if (existing?.status === "failed") return null;
      return existing || null;
    });
    if (cached) return NextResponse.json(cached);

    const selectedPlatform = platformFromActorSource(dimensions.actorSources[0] || "");
    let runMeta: Awaited<ReturnType<typeof startKeywordScanRun>> | null = null;
    let startError = "";
    try {
      runMeta = await startKeywordScanRun(query, dimensions, minViews);
    } catch (err) {
      startError = err instanceof Error ? err.message : "Apify keyword scan failed to start";
    }

    if (!runMeta) {
      try {
        const fallbackItems = await scanKeywordsWithApify(query, dimensions, minViews, { skipPlatformActor: true });
        const normalized = apifyItemsToResearchResults(fallbackItems);
        const scan = await mutateDb((db) => {
          db.researchScans ||= [];
          db.competitors ||= [];
          db.competitorResults ||= [];
          const competitor = { id: id("cmp"), workspaceId, platform: selectedPlatform, handle: query, url: cacheKey, minViews, cadence: "weekly" as const, lastScraped: new Date().toISOString() };
          db.competitors.push(competitor);
          const results: CompetitorResult[] = normalized.map((result) => ({
            ...result,
            id: id("res"),
            workspaceId,
            competitorId: competitor.id,
            platform: result.platform || selectedPlatform,
            capturedAt: new Date().toISOString()
          }));
          db.competitorResults.push(...results);
          const created: ResearchScan = {
            id: id("scan"),
            workspaceId,
            url: cacheKey,
            query,
            dimensions,
            platform: selectedPlatform,
            minViews,
            resultIds: results.map((result) => result.id),
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            source: "fallback",
            status: "done",
            error: startError ? `${startError}; broader Apify keyword fallback used.` : "Broader Apify keyword fallback used."
          };
          db.researchScans.push(created);
          db.researchScans = db.researchScans.filter((item) => item.workspaceId !== workspaceId).concat(db.researchScans.filter((item) => item.workspaceId === workspaceId).slice(-10));
          db.activity.push({ id: id("act"), workspaceId, message: `Keyword research completed for "${query}" using fallback search.`, createdAt: new Date().toISOString() });
          return created;
        });
        return NextResponse.json(scan);
      } catch (err) {
        startError = err instanceof Error ? `${startError}; fallback failed: ${err.message}` : `${startError}; fallback failed`;
      }
    }

    const scan = await mutateDb((db) => {
      db.researchScans ||= [];
      const created: ResearchScan = {
        id: id("scan"),
        workspaceId,
        url: cacheKey,
        query,
        dimensions,
        platform: selectedPlatform,
        minViews,
        resultIds: [],
        createdAt: new Date().toISOString(),
        source: "apify",
        status: runMeta ? "running" : "failed",
        apifyRunId: runMeta?.runId,
        apifyDatasetId: runMeta?.datasetId,
        apifyActorId: runMeta?.actorId,
        error: startError
      };
      db.researchScans.push(created);
      db.researchScans = db.researchScans.filter((item) => item.workspaceId !== workspaceId).concat(db.researchScans.filter((item) => item.workspaceId === workspaceId).slice(-10));
      db.activity.push({ id: id("act"), workspaceId, message: runMeta ? `Keyword research started for "${query}" using Apify. You can leave Research and come back later.` : `Keyword research failed to start for "${query}".`, createdAt: new Date().toISOString() });
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
    const sourceFormat = sourceFormatFromResearchResult(result);
    const sourceKind = contentKindFromFormat(sourceFormat);
    const personaContext = await mutateDb((db) => buildPersonaContext(db.personaProfiles.find((item) => item.workspaceId === workspaceId)));
    const planInput = { ...result, niche, personaContext };
    const geminiPrompt = buildContentPlanPrompt(planInput);
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
      plan = await generateContentPlanWithGemini(planInput, geminiPrompt);
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
        format: sourceFormat,
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
        format: sourceFormat,
        platforms: Array.isArray(plan.platforms) ? plan.platforms : [result.platform],
        description: String(plan.description || ""),
        videoPrompt: String(plan.videoPrompt || ""),
        duration: sourceKind === "video" ? Number(plan.duration || defaultDuration(sourceFormat) || 0) || undefined : undefined,
        hooks: Array.isArray(plan.hooks) ? plan.hooks : [],
        outline: Array.isArray(plan.outline) ? plan.outline : [],
        shotList: Array.isArray(plan.shotList) ? plan.shotList : [],
        creativeNotes: String(plan.creativeNotes || ""),
        sourceResultId: result.id,
        sourceUrl: result.url,
        sourceTitle: result.title,
        sourcePlatform: result.platform,
        sourceThumbnailUrl: result.thumbnailUrl,
        sourceMediaUrl: result.mediaUrl,
        sourceMediaType: result.mediaType,
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
    const requestedModel = String(body.requestedModel || "");
    const requestedDuration = requestedFormat.toLowerCase().includes("video") ? closestVideoDuration(body.requestedDuration, requestedModel || "veo-fast") : undefined;
    const workspace = await mutateDb((db) => db.workspaces.find((item) => item.id === workspaceId) || null);
    const niche = workspace?.niche?.trim() || "";
    const personaContext = await mutateDb((db) => buildPersonaContext(db.personaProfiles.find((item) => item.workspaceId === workspaceId)));
    const prompt = buildAiBriefPrompt({ idea, niche, requestedFormat, requestedDuration, requestedModel, personaContext });
    await debugLog(workspaceId, {
      action,
      label: "Prompt sent to Kie GPT-5.5 for new content plan",
      status: "started",
      provider: "kie",
      prompt,
      details: { model: "gpt-5-5", idea, requestedFormat: requestedFormat || undefined, requestedDuration, requestedModel: requestedModel || undefined }
    });
    try {
      const plan = await generateContentPlanWithGpt55({ idea, niche, requestedFormat, requestedDuration, requestedModel, personaContext }, prompt);
      const format = requestedFormat || String(plan.format || "Short video 9:16");
      const resolvedFormat = contentPlanFormats.includes(format) ? format : "Short video 9:16";
      const resolvedKind = contentKindFromFormat(resolvedFormat);
      const normalizedDuration = resolvedKind === "video" ? closestVideoDuration(requestedDuration || plan.duration || defaultDuration(resolvedFormat), requestedModel || "veo-fast", defaultDuration(resolvedFormat) || 8) : "";
      const durationNote = resolvedKind === "video"
        ? `\n\nDuration constraint: create exactly ${normalizedDuration} seconds for ${requestedModel || "the selected video model"}. Keep scenes short and do not request longer runtime.`
        : "";
      const draft = {
        topic: String(plan.topic || idea),
        format: resolvedFormat,
        description: String(plan.description || ""),
        videoPrompt: `${String(plan.videoPrompt || "").trim()}${durationNote}`.trim(),
        duration: normalizedDuration,
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

  if (action === "refineResearchVideoPrompt") {
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "Video prompt is required." }, { status: 400 });
    const { refineTemplate, personaContext } = await mutateDb((db) => ({
      refineTemplate: db.promptTemplates?.researchVideoPromptRefine || "",
      personaContext: buildPersonaContext(db.personaProfiles.find((item) => item.workspaceId === workspaceId))
    }));
    const promptWithPersona = appendPersonaContext(prompt, personaContext);
    const fullInstruction = buildFinalVideoPromptInstruction(promptWithPersona, refineTemplate);
    await debugLog(workspaceId, {
      action,
      label: "Prompt sent to Kie GPT-5.5 for final research video prompt",
      status: "started",
      provider: "kie",
      prompt: fullInstruction,
      details: {
        model: "gpt-5-5",
        generationModel: String(body.generationModel || ""),
        sourcePrompt: promptWithPersona,
        duration: body.duration,
        sourceUrl: String(body.sourceUrl || ""),
        assetReferences: parseAssetReferences(body.assetReferences).map((ref) => ({ role: ref.role, fileName: ref.fileName, url: ref.url || "" }))
      }
    });
    try {
      const refined = await generateFinalVideoPromptWithGpt55(promptWithPersona, refineTemplate);
      await debugLog(workspaceId, {
        action,
        label: "Kie GPT-5.5 returned final research video prompt for G01",
        status: "success",
        provider: "kie",
        prompt: refined.videoPrompt,
        details: { model: "gpt-5-5", characters: refined.videoPrompt.length, debugJson: refined.debugJson }
      });
      return NextResponse.json(refined);
    } catch (error) {
      await debugLog(workspaceId, {
        action,
        label: "Kie GPT-5.5 final research video prompt failed",
        status: "failed",
        provider: "kie",
        prompt: promptWithPersona,
        error: error instanceof Error ? error.message : "Kie GPT-5.5 video prompt failed"
      });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Kie GPT-5.5 video prompt failed" }, { status: 502 });
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
    const prompt = enhanceVideoPromptForProvider({
      prompt: asset.prompt || asset.title,
      model,
      duration: Number(settings.duration || snapshot.publishItem?.duration || 8),
      aspectRatio: String(settings.aspectRatio || "9:16"),
      references: asset.assetReferences || []
    });
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

  if (action === "autoFillPersonaProfile") {
    const existing = await mutateDb((db) => db.personaProfiles.find((item) => item.workspaceId === workspaceId) || defaultPersonaProfile(workspaceId));
    const sourceUrls = {
      linkedin: String(body.linkedinUrl || existing.sourceUrls.linkedin || "").trim(),
      website: String(body.websiteUrl || existing.sourceUrls.website || "").trim(),
      instagram: String(body.instagramUrl || existing.sourceUrls.instagram || "").trim(),
      facebook: String(body.facebookUrl || existing.sourceUrls.facebook || "").trim(),
      x: String(body.xUrl || existing.sourceUrls.x || "").trim()
    };
    if (!Object.values(sourceUrls).some(Boolean)) return NextResponse.json({ error: "Add at least one profile URL before auto-fill." }, { status: 400 });
    await debugLog(workspaceId, {
      action,
      label: "Persona auto-fill crawl started",
      status: "started",
      provider: "apify",
      details: { sourceUrls }
    });
    try {
      const crawled = await crawlPersonaSourcesWithApify(sourceUrls);
      const prompt = buildPersonaAutofillPrompt({ current: existing, crawled });
      await debugLog(workspaceId, {
        action,
        label: "Prompt sent to Kie GPT-5.5 for persona auto-fill",
        status: "started",
        provider: "kie",
        prompt,
        details: { model: "gpt-5-5", crawledSources: crawled.map((item) => ({ source: item.source, itemCount: item.itemCount })) }
      });
      let compactGenerated: Record<string, unknown>;
      let usedFallback = false;
      try {
        const generated = await generatePersonaAutofillWithGpt55(prompt) as Record<string, unknown>;
        const providerError = providerErrorFromJson(generated);
        if (providerError) throw new Error(providerError);
        compactGenerated = compactAutofillOutput(generated);
      } catch (error) {
        compactGenerated = fallbackPersonaFromCrawl(existing, crawled);
        usedFallback = true;
        await debugLog(workspaceId, {
          action,
          label: "Kie GPT-5.5 persona auto-fill fallback used",
          status: "failed",
          provider: "kie",
          error: error instanceof Error ? error.message : "Kie persona auto-fill failed",
          details: { fallbackGenerated: compactGenerated }
        });
      }
      await debugLog(workspaceId, {
        action,
        label: "Kie GPT-5.5 returned persona auto-fill JSON",
        status: usedFallback ? "failed" : "success",
        provider: usedFallback ? "system" : "kie",
        details: { generated: compactGenerated, usedFallback }
      });
      const profile = await mutateDb((db) => {
        db.personaProfiles ||= [];
        const existingIndex = db.personaProfiles.findIndex((item) => item.workspaceId === workspaceId);
        const previous = existingIndex >= 0 ? db.personaProfiles[existingIndex] : existing;
        const merged = personaFromBody(workspaceId, { ...compactGenerated, ...Object.fromEntries(Object.entries(sourceUrls).map(([key, value]) => [`${key}Url`, value])) }, previous);
        if (existingIndex >= 0) db.personaProfiles[existingIndex] = merged;
        else db.personaProfiles.push(merged);
        db.activity.push({ id: id("act"), workspaceId, message: `Persona auto-filled from ${crawled.length} public source(s).`, createdAt: new Date().toISOString() });
        return merged;
      });
      await debugLog(workspaceId, {
        action,
        label: "Persona auto-fill completed",
        status: "success",
        provider: usedFallback ? "system" : "kie",
        details: { model: "gpt-5-5", usedFallback, displayName: profile.displayName, company: profile.company }
      });
      return NextResponse.json(profile);
    } catch (error) {
      await debugLog(workspaceId, {
        action,
        label: "Persona auto-fill failed",
        status: "failed",
        provider: "system",
        error: error instanceof Error ? error.message : "Persona auto-fill failed"
      });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Persona auto-fill failed" }, { status: 502 });
    }
  }

  if (action === "updatePromptTemplates") {
    const username = String(body.adminUsername || "");
    const password = String(body.adminPassword || "");
    if (username !== "admin" || password !== "admin") {
      return NextResponse.json({ error: "Invalid prompt admin username or password." }, { status: 401 });
    }
    const video = String(body.researchVideoRecreate || "").trim();
    const image = String(body.researchImageRecreate || "").trim();
    const refine = String(body.researchVideoPromptRefine || "").trim();
    const text = String(body.researchTextRecreate || "").trim();
    if (!video || !image || !refine || !text) return NextResponse.json({ error: "Research video, image, text, and final video prompt templates are required." }, { status: 400 });
    const templates = await mutateDb((db) => {
      db.promptTemplates = {
        ...(db.promptTemplates || {}),
        researchVideoRecreate: video,
        researchImageRecreate: image,
        researchVideoPromptRefine: refine,
        researchTextRecreate: text
      };
      db.activity.push({ id: id("act"), workspaceId, message: "Prompt templates updated by admin.", createdAt: new Date().toISOString() });
      return db.promptTemplates;
    });
    await debugLog(workspaceId, {
      action,
      label: "Prompt templates updated",
      status: "success",
      provider: "system",
      details: { keys: Object.keys(templates) }
    });
    return NextResponse.json(templates);
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
      activity(`Persona profile saved: ${profile.displayName || "Unnamed persona"}`);
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
      const duration = generationType === "video" ? closestVideoDuration(body.duration || brief.duration || defaultDuration(brief.format) || 8, model) : undefined;
      const assetReferences = parseAssetReferences(body.assetReferences);
      const personaContext = buildPersonaContext(db.personaProfiles.find((item) => item.workspaceId === workspaceId));
      const basePrompt = enrichPromptWithAssetReferences(appendPersonaContext(String(body.prompt || defaultPromptForBrief(brief, generationType)), personaContext), generationType, assetReferences);
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
      const prompt = generationType === "video"
        ? enhanceVideoPromptForProvider({ prompt: basePrompt, model, duration, aspectRatio: String(generationSettings.aspectRatio || "9:16"), references: assetReferences })
        : basePrompt;
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
        sourceUrl: brief.sourceUrl,
        sourceTitle: brief.sourceTitle,
        sourceThumbnailUrl: brief.sourceThumbnailUrl,
        sourceMediaUrl: brief.sourceMediaUrl,
        sourceMediaType: brief.sourceMediaType,
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
        sourceUrl: brief.sourceUrl,
        sourceTitle: brief.sourceTitle,
        sourceThumbnailUrl: brief.sourceThumbnailUrl,
        sourceMediaUrl: brief.sourceMediaUrl,
        sourceMediaType: brief.sourceMediaType,
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
      const duration = generationType === "video" ? closestVideoDuration(body.duration || 8, model) : undefined;
      const assetReferences = parseAssetReferences(body.assetReferences);
      const workspace = db.workspaces.find((entry) => entry.id === workspaceId);
      const context = workspace?.niche?.trim() || "the configured brand";
      const personaContext = buildPersonaContext(db.personaProfiles.find((item) => item.workspaceId === workspaceId));
      const basePrompt = enrichPromptWithAssetReferences(appendPersonaContext(String(body.prompt || `Create a practical founder-led social post for ${context}.`), personaContext), generationType, assetReferences);
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
      const prompt = generationType === "video"
        ? enhanceVideoPromptForProvider({ prompt: basePrompt, model, duration, aspectRatio: String(generationSettings.aspectRatio || "9:16"), references: assetReferences })
        : basePrompt;
      const now = new Date().toISOString();
      const title = prompt.split(/\n|\.|\?/)[0].slice(0, 96) || "Direct content draft";
      const type: Asset["type"] = generationType === "video" ? "video" : generationType === "image" ? "image" : "text";
      const sourceUrl = String(body.sourceUrl || "");
      const sourceTitle = String(body.sourceTitle || "");
      const sourceThumbnailUrl = String(body.sourceThumbnailUrl || "");
      const sourceMediaUrl = String(body.sourceMediaUrl || "");
      const sourceMediaType = String(body.sourceMediaType || "") as "video" | "image" | "unknown";
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
        sourceUrl,
        sourceTitle,
        sourceThumbnailUrl,
        sourceMediaUrl,
        sourceMediaType,
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
        sourceUrl,
        sourceTitle,
        sourceThumbnailUrl,
        sourceMediaUrl,
        sourceMediaType,
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
        duration: generatedAsset?.generationSettings?.duration,
        aspectRatio: generatedAsset?.generationSettings?.aspectRatio,
        referenceCount: generatedAsset?.assetReferences?.length || 0,
        references: generatedAsset?.assetReferences || [],
        status: generatedAsset?.status
      }
    });
  }
  if ((action === "renderAsset" || action === "generateUgc") && generatedAsset?.provider === "kie") {
    try {
      const model = generatedAsset.generationModel || String(body.generationModel || "veo-fast");
      const references = generatedAsset.assetReferences || parseAssetReferences(body.assetReferences);
      const prompt = enhanceVideoPromptForProvider({
        prompt: generatedAsset.prompt || generatedAsset.title,
        model,
        duration: Number(body.duration || generatedAsset.generationSettings?.duration || 8),
        aspectRatio: String(body.aspectRatio || generatedAsset.generationSettings?.aspectRatio || "9:16"),
        references
      });
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
