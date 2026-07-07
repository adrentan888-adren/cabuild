import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { defaultPersonaProfile, id, mutateDb } from "@/lib/store";
import type { Asset, AutomationJob, AutomationRule, AutomationSourceRun, AutomationSourceWatcher, Brief, CompetitorResult, GenerationAssetReference, PersonaMediaAsset, PersonaProfile, Platform, PublishItem, ResearchScan } from "@/lib/types";
import { appendPersonaContext, buildPersonaContext, normalizePersonaProfile } from "@/lib/persona";
import { completeKeywordScanRun, completeSocialUrlScanRun, crawlPersonaSourcesWithApify, fetchTrendSignals, scanKeywordsWithApify, scanSocialUrl, startKeywordScanRun, startSocialUrlScanRun } from "@/lib/providers/apify";
import { buildAiBriefPrompt, buildContentPlanPrompt, buildFinalVideoPromptInstruction, generateContentPlanWithGemini, generateContentPlanWithGpt55, generateFinalVideoPromptWithGpt55, generateImage, generatePersonaAutofillWithGpt55, generateSeedanceVideo, generateTextContentWithKie, generateVeoVideo, getMarketTask, getVeoVideo } from "@/lib/providers/kie";
import { getConnectedUploadPostAccounts, publishPhotoPost, publishTextPost, publishVideoPost } from "@/lib/providers/uploadPost";
import { reserveBillingCredits, releaseBillingReservation, settleBillingReservation } from "@/lib/billing";
import { encodeUploadKey, saveGeneratedMediaFromUrl } from "@/lib/providers/uploads";

const allowedPlatforms: Platform[] = ["TikTok", "Instagram", "YouTube", "LinkedIn", "Facebook", "X"];

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

function isKieTextModel(model: string) {
  return model === "gemini-3.5-flash" || model === "gpt-5-5" || model === "claude-opus-4.8";
}

function publicOrigin(req: Request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

function preferredGeneratedContentType(asset: Pick<Asset, "type">) {
  if (asset.type === "video" || asset.type === "ugc") return "video/mp4";
  if (asset.type === "text") return "text/plain";
  return "image/png";
}

async function persistGeneratedAssetUrl(input: { origin: string; workspaceId: string; asset: Pick<Asset, "id" | "type" | "title">; providerUrl: string }) {
  try {
    const stored = await saveGeneratedMediaFromUrl({
      workspaceId: input.workspaceId,
      assetId: input.asset.id,
      sourceUrl: input.providerUrl,
      preferredContentType: preferredGeneratedContentType(input.asset)
    });
    return {
      assetUrl: `${input.origin}/api/public-uploads/${encodeUploadKey(stored.key)}`,
      providerUrl: input.providerUrl,
      storageKey: stored.key,
      contentType: stored.contentType,
      size: stored.size,
      storageError: ""
    };
  } catch (error) {
    return {
      assetUrl: input.providerUrl,
      providerUrl: input.providerUrl,
      storageKey: "",
      contentType: preferredGeneratedContentType(input.asset),
      size: 0,
      storageError: error instanceof Error ? error.message : "Generated media storage failed."
    };
  }
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

function billingErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Billing check failed.";
  const status = /insufficient credits/i.test(message) ? 402 : /no billing rate configured/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status });
}

async function reservePaidAction(input: {
  workspaceId: string;
  userId?: string;
  quoteInput: Record<string, unknown>;
  relatedId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const result = await mutateDb((db) => reserveBillingCredits(db, input));
  await debugLog(input.workspaceId, {
    action: String(input.quoteInput.action || "billing.reserve"),
    label: result.reservation ? `Billing reserved: ${result.quote.label}` : `Billing included: ${result.quote.label}`,
    status: "success",
    provider: "system",
    details: {
      reservationId: result.reservation?.id,
      quote: result.quote,
      relatedId: input.relatedId,
      metadata: input.metadata
    }
  });
  return { quote: result.quote, reservationId: result.reservation?.id };
}

async function settlePaidAction(input: {
  workspaceId: string;
  reservationId?: string;
  actualCredits?: number;
  providerTaskId?: string;
  relatedId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.reservationId) return;
  const settled = await mutateDb((db) => settleBillingReservation(db, input));
  await debugLog(input.workspaceId, {
    action: settled?.action || "billing.settle",
    label: `Billing settled: ${input.actualCredits || settled?.credits || 0} credits`,
    status: "success",
    provider: "system",
    details: {
      reservationId: input.reservationId,
      providerTaskId: input.providerTaskId,
      relatedId: input.relatedId,
      metadata: input.metadata
    }
  });
}

async function releasePaidAction(input: {
  workspaceId: string;
  reservationId?: string;
  providerTaskId?: string;
  relatedId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.reservationId) return;
  const released = await mutateDb((db) => releaseBillingReservation(db, input));
  await debugLog(input.workspaceId, {
    action: released?.action || "billing.release",
    label: "Billing reservation released",
    status: "success",
    provider: "system",
    details: {
      reservationId: input.reservationId,
      providerTaskId: input.providerTaskId,
      relatedId: input.relatedId,
      metadata: input.metadata
    }
  });
}

function generationBillingInput(action: string, moduleName: string, generationType: "video" | "image" | "text", model: string, duration?: number | string, extra: Record<string, unknown> = {}) {
  return {
    action,
    module: moduleName,
    generationType,
    model,
    duration: generationType === "video" ? Number(duration || 8) : undefined,
    resolution: generationType === "image" ? "1K" : undefined,
    inputTokens: generationType === "text" ? Number(extra.inputTokens || 2200) : undefined,
    outputTokens: generationType === "text" ? Number(extra.outputTokens || 1200) : undefined,
    ...extra
  };
}

function publishDescription(item: PublishItem, asset?: Asset) {
  return [item.caption, ...(item.hashtags || [])].filter(Boolean).join("\n\n") || asset?.prompt || item.prompt || item.title;
}

async function sendToUploadPost(item: PublishItem, asset?: Asset) {
  const description = publishDescription(item, asset);
  if (asset?.assetUrl && (item.generationType === "image" || asset.type === "image")) {
    return publishPhotoPost({ title: item.title, description, platform: item.platform, photoUrl: asset.assetUrl, scheduledAt: undefined });
  }
  if (asset?.assetUrl) {
    return publishVideoPost({ title: item.title, description, platform: item.platform, videoUrl: asset.assetUrl, scheduledAt: undefined });
  }
  return publishTextPost({ title: item.title, description, platform: item.platform, scheduledAt: undefined });
}

async function autoPublishReadySourceWatcherItems(workspaceId: string, action: string, assetId?: string) {
  const candidates = await mutateDb((db) => {
    return db.publishQueue
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => !assetId || item.assetId === assetId)
      .filter((item) => item.status === "done")
      .filter((item) => item.provider !== "upload-post")
      .map((item) => {
        const asset = db.assets.find((asset) => asset.id === item.assetId && asset.workspaceId === workspaceId);
        const watcherId = String((item.generationSettings?.sourceWatcherId || asset?.generationSettings?.sourceWatcherId || "") as string);
        const watcher = watcherId ? (db.automationSourceWatchers || []).find((watcher) => watcher.id === watcherId && watcher.workspaceId === workspaceId) : undefined;
        if (!watcher || watcher.approvalMode !== "auto-publish") return null;
        if ((item.generationType === "video" || item.generationType === "image") && !asset?.assetUrl && !item.assetUrl) return null;
        return { item, asset };
      })
      .filter((entry): entry is { item: PublishItem; asset: Asset | undefined } => Boolean(entry));
  });

  const results = [];
  for (const candidate of candidates) {
    await debugLog(workspaceId, {
      action,
      label: `Automation auto-publish sent to Upload-Post: ${candidate.item.title}`,
      status: "started",
      provider: "upload-post",
      prompt: publishDescription(candidate.item, candidate.asset),
      details: {
        publishId: candidate.item.id,
        assetId: candidate.asset?.id,
        platform: candidate.item.platform,
        generationType: candidate.item.generationType,
        hasAssetUrl: Boolean(candidate.asset?.assetUrl || candidate.item.assetUrl)
      }
    });
    try {
      const upload = await sendToUploadPost(candidate.item, candidate.asset);
      const updated = await mutateDb((db) => {
        const item = db.publishQueue.find((item) => item.id === candidate.item.id && item.workspaceId === workspaceId);
        if (!item) return null;
        item.status = "published";
        item.provider = "upload-post";
        item.providerRequestId = upload.request_id || upload.job_id;
        item.error = "";
        db.activity.push({ id: id("act"), workspaceId, message: `Automation auto-published "${item.title}" through Upload-Post.`, createdAt: new Date().toISOString() });
        return item;
      });
      await debugLog(workspaceId, {
        action,
        label: `Automation auto-publish accepted: ${candidate.item.title}`,
        status: "success",
        provider: "upload-post",
        details: { requestId: upload.request_id, jobId: upload.job_id, platform: candidate.item.platform }
      });
      results.push({ id: candidate.item.id, status: "published", requestId: upload.request_id || upload.job_id, item: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload-Post publish failed";
      await mutateDb((db) => {
        const item = db.publishQueue.find((item) => item.id === candidate.item.id && item.workspaceId === workspaceId);
        if (item) {
          item.status = "failed";
          item.provider = "upload-post";
          item.error = message;
        }
      });
      await debugLog(workspaceId, { action, label: "Automation auto-publish failed", status: "failed", provider: "upload-post", error: message });
      results.push({ id: candidate.item.id, status: "failed", error: message });
    }
  }
  return results;
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

function parsePersonaMediaAssets(input: unknown): PersonaMediaAsset[] {
  const raw = typeof input === "string" ? (() => {
    try {
      return JSON.parse(input);
    } catch {
      return [];
    }
  })() : input;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const role = String(record.role || "").trim();
      const url = String(record.url || "").trim();
      const fileName = String(record.fileName || "").trim();
      if (!["product photo", "avatar/persona", "logo", "audio"].includes(role) || !url || !fileName) return [];
      return [{
        id: String(record.id || `pmedia_${Date.now()}_${index}`),
        role: role as PersonaMediaAsset["role"],
        label: String(record.label || fileName).trim() || fileName,
        fileName,
        url,
        storageKey: String(record.storageKey || "").trim() || undefined,
        contentType: String(record.contentType || "").trim() || undefined,
        createdAt: String(record.createdAt || new Date().toISOString())
      }];
    });
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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nextAutomationRunAt(frequency: AutomationRule["frequency"], postingTime: string) {
  const now = new Date();
  const [hoursRaw, minutesRaw] = postingTime.split(":");
  const hours = clampNumber(hoursRaw, 10, 0, 23);
  const minutes = clampNumber(minutesRaw, 0, 0, 59);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + (frequency === "weekly" ? 7 : 1));
  return next.toISOString();
}

function automationTitle(rule: Pick<AutomationRule, "goal" | "instruction" | "contentType">) {
  const firstLine = rule.instruction.split(/\n|\.|\?/)[0]?.trim();
  const prefix = rule.goal.charAt(0).toUpperCase() + rule.goal.slice(1);
  return `${prefix} ${rule.contentType.replace("-", " ")}: ${firstLine || "scheduled content"}`.slice(0, 110);
}

function normalizeIdeaText(value: string) {
  const stopWords = new Set(["the", "and", "or", "a", "an", "to", "for", "of", "in", "on", "with", "from", "by", "is", "are", "be", "this", "that", "it", "as", "at", "your", "you"]);
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function ideaSimilarity(a: string, b: string) {
  const left = new Set(normalizeIdeaText(a));
  const right = new Set(normalizeIdeaText(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  left.forEach((word) => {
    if (right.has(word)) overlap += 1;
  });
  return overlap / (left.size + right.size - overlap);
}

function sourceOverlapScore(sourceUrls: string[], candidate: string) {
  const normalized = sourceUrls.map((url) => url.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0 || !candidate) return 0;
  const lower = candidate.toLowerCase();
  return normalized.some((url) => lower.includes(url) || url.includes(lower)) ? 1 : 0;
}

function automationPrompt(rule: AutomationRule) {
  const platformText = rule.platforms.length ? rule.platforms.join(", ") : "selected social platforms";
  return [
    `Create a ${rule.contentType.replace("-", " ")} automation draft for ${platformText}.`,
    `Goal: ${rule.goal}.`,
    `Dimension: ${rule.aspectRatio}.`,
    `Model preference: ${rule.model}.`,
    `User instruction: ${rule.instruction}`,
    rule.keywords.length ? `Keywords to consider: ${rule.keywords.join(", ")}.` : "",
    rule.sourceUrls.length ? `Research/source URLs to consider: ${rule.sourceUrls.join(", ")}.` : "",
    rule.researchMode !== "none" ? `Research mode: ${rule.researchMode}. Use relevant recent research only when it fits the instruction.` : "Research mode: none. Use the instruction only.",
    rule.restrictions ? `Restrictions: ${rule.restrictions}` : "",
    `Duplicate protection: ${rule.duplicateProtection.mode}. Avoid topics, source URLs, hooks, captions, visual structures, and angles similar to recent history within ${rule.duplicateProtection.topicWindowDays} days.`,
    "Produce a fresh, reviewable content draft. Do not call a generation provider or publish automatically in this staging step."
  ].filter(Boolean).join("\n");
}

function automationHashtag(keyword: string) {
  const cleaned = keyword.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned ? `#${cleaned}` : "";
}

function automationKindFromContentType(contentType: string): "video" | "image" | "text" | "auto" {
  if (contentType === "short-video" || contentType === "long-video" || contentType === "video") return "video";
  if (contentType === "text") return "text";
  if (contentType === "auto") return "auto";
  return "image";
}

function defaultAutomationModel(contentType: string) {
  const kind = automationKindFromContentType(contentType);
  if (kind === "video") return "veo-fast";
  if (kind === "image") return "gpt-image-2";
  if (kind === "text") return "gemini-3.5-flash";
  return "auto";
}

function normalizeAutomationModel(contentType: string, value: unknown) {
  const model = String(value || "").trim();
  const kind = automationKindFromContentType(contentType);
  const valid = kind === "video"
    ? ["veo-fast", "seedance-2.0"]
    : kind === "image"
      ? ["gpt-image-2", "nanobanana-pro"]
      : kind === "text"
        ? ["gemini-3.5-flash", "claude-opus-4.8"]
        : ["auto", "veo-fast", "seedance-2.0", "gpt-image-2", "nanobanana-pro", "gemini-3.5-flash", "claude-opus-4.8"];
  return valid.includes(model) ? model : defaultAutomationModel(contentType);
}

function normalizeAutomationAspectRatio(contentType: string, value: unknown) {
  const ratio = String(value || "").trim();
  if (contentType === "long-video") return "16:9";
  if (contentType === "short-video" || contentType === "video") return ratio === "16:9" ? "16:9" : "9:16";
  if (contentType === "text") return "1:1";
  if (contentType === "auto") return ratio === "16:9" ? "16:9" : "9:16";
  return ["1:1", "4:5", "9:16", "16:9"].includes(ratio) ? ratio : "4:5";
}

function modelForResolvedSourceWatcherKind(watcherModel: string, generationType: "video" | "image" | "text") {
  if (generationType === "video") return ["veo-fast", "seedance-2.0"].includes(watcherModel) ? watcherModel : "veo-fast";
  if (generationType === "image") return isKieImageModel(watcherModel) ? watcherModel : "gpt-image-2";
  return ["gemini-3.5-flash", "claude-opus-4.8"].includes(watcherModel) ? watcherModel : "gemini-3.5-flash";
}

type SourceWatcherCandidate = {
  id: string;
  platform: Platform;
  sourceUrl: string;
  url: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  mediaType: "video" | "image" | "unknown";
  views: number;
  likes: number;
  comments: number;
  publishedAt?: string;
  duration?: number;
  score: number;
};

function sourceWatcherNextRunAt(frequency: AutomationSourceWatcher["frequency"], postingTime: string) {
  return nextAutomationRunAt(frequency, postingTime);
}

function sourceWatcherKind(candidate: SourceWatcherCandidate, requested: AutomationSourceWatcher["contentType"]): "video" | "image" | "text" {
  if (requested !== "auto") return requested;
  if (candidate.mediaType === "video") return "video";
  if (candidate.mediaType === "image") return "image";
  return candidate.platform === "LinkedIn" || candidate.platform === "X" ? "text" : "image";
}

function sourceWatcherScore(candidate: Omit<SourceWatcherCandidate, "score">, mode: AutomationSourceWatcher["rankingMode"]) {
  const views = Math.log10(Math.max(candidate.views, 1));
  const engagement = candidate.views > 0 ? ((candidate.likes + candidate.comments * 2) / candidate.views) * 100 : 0;
  const ageHours = candidate.publishedAt ? Math.max(1, (Date.now() - new Date(candidate.publishedAt).getTime()) / 36e5) : 720;
  const recency = Math.max(0, 10 - Math.log10(ageHours + 1) * 3);
  if (mode === "views") return views * 24 + engagement * 2 + recency;
  if (mode === "engagement") return engagement * 18 + views * 8 + recency;
  if (mode === "recent") return recency * 14 + views * 7 + engagement * 4;
  return views * 12 + engagement * 8 + recency * 5;
}

function sourceWatcherReferences(watcher: AutomationSourceWatcher): GenerationAssetReference[] {
  const refs: GenerationAssetReference[] = [...(watcher.referenceAssets || [])];
  if (watcher.referenceUrls.logo) refs.push({ role: "logo", fileName: "source-watcher-logo", url: watcher.referenceUrls.logo });
  if (watcher.referenceUrls.productPhoto) refs.push({ role: "product photo", fileName: "source-watcher-product-photo", url: watcher.referenceUrls.productPhoto });
  if (watcher.referenceUrls.avatar) refs.push({ role: "avatar/persona", fileName: "source-watcher-avatar", url: watcher.referenceUrls.avatar });
  if (watcher.referenceUrls.audio) refs.push({ role: "audio", fileName: "source-watcher-audio", url: watcher.referenceUrls.audio });
  return refs;
}

function sourceWatcherPrompt(input: {
  watcher: AutomationSourceWatcher;
  candidate: SourceWatcherCandidate;
  generationType: "video" | "image" | "text";
  personaContext: string;
}) {
  const { watcher, candidate, generationType, personaContext } = input;
  const media = candidate.mediaUrl || candidate.thumbnailUrl || candidate.url;
  const referenceInstruction = generationType === "text"
    ? "Do not copy the original wording. Rebuild the angle in the user's persona and brand voice."
    : generationType === "image"
      ? "Analyse the attached/source image or graphic and create a fresh social image concept. If logo/product/avatar references are attached, use those user assets to replace original brand/person/product elements. If no matching attachment exists, remove or change the original brand/person/product."
      : "Analyse the attached/source video and create a fresh social video concept. If logo/person/audio/product references are attached, use those user assets to replace original logo/person/audio/product elements. If no matching attachment exists, remove the original logo, change the person, and replace the audio.";
  return appendPersonaContext([
    `Create ${generationType} content based on this high-performing source selected by Source Watcher.`,
    `User automation instruction: ${watcher.instruction}`,
    `Source title: ${candidate.title}`,
    `Source description/caption: ${candidate.description}`,
    `Source media: ${media}`,
    `Exact source post/page: ${candidate.url}`,
    `Performance: ${candidate.views} views, ${candidate.likes} likes, ${candidate.comments} comments.`,
    generationType === "video" ? `The video duration is supposed to be ${watcher.duration || candidate.duration || 8}s.` : "",
    `Target dimension: ${watcher.aspectRatio}.`,
    referenceInstruction,
    "Make the result suitable for the user's saved persona, brand context, and social media audience. Keep it original, high-conversion, mobile-first, and compliance-safe.",
    watcher.referenceUrls.logo ? `Use the uploaded logo/reference URL exactly as the brand logo: ${watcher.referenceUrls.logo}` : "No user logo is attached; do not copy any original source logo.",
    watcher.referenceUrls.productPhoto ? `Use the uploaded product photo/reference URL as the product visual: ${watcher.referenceUrls.productPhoto}` : "",
    watcher.referenceUrls.avatar ? `Use the uploaded avatar/person reference URL for the on-screen person style: ${watcher.referenceUrls.avatar}` : "",
    watcher.referenceUrls.audio && generationType === "video" ? `Use the uploaded audio reference URL only as user-approved audio direction: ${watcher.referenceUrls.audio}` : "",
    "Return an execution-ready prompt/caption direction, not analysis notes."
  ].filter(Boolean).join("\n"), personaContext);
}

function sourceWatcherDuplicate(
  watcher: AutomationSourceWatcher,
  candidate: SourceWatcherCandidate,
  db: { automationSourceRuns?: AutomationSourceRun[]; publishQueue?: PublishItem[]; assets?: Asset[]; competitorResults?: CompetitorResult[] },
  workspaceId: string
) {
  const threshold = watcher.duplicateProtection.similarityThreshold / 100;
  const cutoff = Date.now() - watcher.duplicateProtection.topicWindowDays * 24 * 60 * 60 * 1000;
  const text = [candidate.title, candidate.description, candidate.url].join("\n");
  const history = [
    ...(db.automationSourceRuns || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.selectedTitle || "", text: [item.selectedTitle, item.selectedUrl, item.selectionReason].join("\n"), url: item.selectedUrl || "", createdAt: item.completedAt || item.startedAt })),
    ...(db.publishQueue || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt, item.caption].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt || item.scheduledAt })),
    ...(db.assets || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt })),
    ...(db.competitorResults || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.description].join("\n"), url: item.url, createdAt: item.capturedAt || item.publishedAt }))
  ].filter((item) => !item.createdAt || new Date(item.createdAt).getTime() >= cutoff);
  let best = { score: 0, title: "", id: "", reason: "No duplicate found." };
  for (const item of history) {
    const score = Math.max(sourceOverlapScore([candidate.url], item.url), ideaSimilarity(text, item.text));
    if (score > best.score) best = { score, title: item.title, id: item.id, reason: score >= 1 ? "Exact source URL was used before." : "Similar source/topic was used before." };
  }
  return { duplicate: best.score >= threshold, best, threshold };
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

function fallbackPersonaCrawlFromUrls(sourceUrls: Record<string, string>) {
  return Object.entries(sourceUrls)
    .filter(([, url]) => url.trim())
    .map(([source, url]) => {
      const name = nameFromProfileUrl(url);
      const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);
      const text = [name, `${name || sourceLabel} public ${sourceLabel} profile`, url].filter(Boolean).join("\n");
      return { source, url, text, itemCount: 0 };
    });
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
    mediaAssets: hasField(body, "mediaAssets") ? parsePersonaMediaAssets(body.mediaAssets) : fallback.mediaAssets,
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
  const origin = publicOrigin(req);
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
      const storageEvents: Array<{ assetId: string; title: string; providerUrl: string; assetUrl: string; storageKey: string; contentType: string; size: number; storageError: string }> = [];
      const updated = await mutateDb(async (db) => {
        const asset = db.assets.find((item) => item.id === body.id && item.workspaceId === workspaceId);
        if (!asset?.providerTaskId) throw new Error("Asset has no provider task to poll.");
        const publishItems = db.publishQueue.filter((item) => item.assetId === asset.id && item.workspaceId === workspaceId);
        const generationModel = asset.generationModel || publishItems.find((item) => item.generationModel)?.generationModel || "";
        const isMarketTask = generationModel === "seedance-2.0" || isKieImageModel(generationModel) || asset.providerTaskId.startsWith("task_");
        if (isMarketTask) {
          const status = await getMarketTask(asset.providerTaskId);
          if (status.state === "success" && status.assetUrl) {
            const persisted = await persistGeneratedAssetUrl({ origin, workspaceId, asset, providerUrl: status.assetUrl });
            storageEvents.push({ assetId: asset.id, title: asset.title, ...persisted });
            asset.status = "ready";
            asset.progress = 100;
            asset.assetUrl = persisted.assetUrl;
            asset.error = "";
            asset.generationSettings = {
              ...(asset.generationSettings || {}),
              providerAssetUrl: persisted.providerUrl,
              generatedStorageKey: persisted.storageKey,
              generatedStorageContentType: persisted.contentType,
              generatedStorageSize: persisted.size,
              generatedStorageError: persisted.storageError
            };
            publishItems.forEach((item) => {
              item.status = "done";
              item.assetUrl = persisted.assetUrl;
              item.error = "";
              item.generationSettings = {
                ...(item.generationSettings || {}),
                providerAssetUrl: persisted.providerUrl,
                generatedStorageKey: persisted.storageKey,
                generatedStorageContentType: persisted.contentType,
                generatedStorageSize: persisted.size,
                generatedStorageError: persisted.storageError
              };
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
            const persisted = await persistGeneratedAssetUrl({ origin, workspaceId, asset, providerUrl: status.assetUrl });
            storageEvents.push({ assetId: asset.id, title: asset.title, ...persisted });
            asset.status = "ready";
            asset.progress = 100;
            asset.assetUrl = persisted.assetUrl;
            asset.error = "";
            asset.generationSettings = {
              ...(asset.generationSettings || {}),
              providerAssetUrl: persisted.providerUrl,
              generatedStorageKey: persisted.storageKey,
              generatedStorageContentType: persisted.contentType,
              generatedStorageSize: persisted.size,
              generatedStorageError: persisted.storageError
            };
            publishItems.forEach((item) => {
              item.status = "done";
              item.assetUrl = persisted.assetUrl;
              item.error = "";
              item.generationSettings = {
                ...(item.generationSettings || {}),
                providerAssetUrl: persisted.providerUrl,
                generatedStorageKey: persisted.storageKey,
                generatedStorageContentType: persisted.contentType,
                generatedStorageSize: persisted.size,
                generatedStorageError: persisted.storageError
              };
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
      for (const event of storageEvents) {
        await debugLog(workspaceId, {
          action,
          label: event.storageError ? `Generated media storage fallback: ${event.title}` : `Generated media stored: ${event.title}`,
          status: event.storageError ? "failed" : "success",
          provider: "system",
          details: event
        });
      }
      const autoPublish = await autoPublishReadySourceWatcherItems(workspaceId, action, updated.id);
      return NextResponse.json({ ...updated, autoPublish });
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: {
          action: "social_audit.url_scan",
          module: "social_audit",
          provider: "apify",
          platform,
          maxResults: 100
        },
        description: `Reserve credits for Social Audit scan: ${url}`,
        metadata: { url, minViews, platform }
      });
    } catch (billingError) {
      await debugLog(workspaceId, { action, label: "Social Audit blocked by billing", status: "failed", provider: "system", error: billingError instanceof Error ? billingError.message : "Billing check failed" });
      return billingErrorResponse(billingError);
    }
    try {
      const apifyItems = await scanSocialUrl(url, minViews);
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: `Charged Social Audit scan for ${handleFromUrl(url)}.`,
        metadata: { url, minViews, platform, returnedResults: apifyItems.length }
      });
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
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: `Released Social Audit reservation because Apify failed: ${handleFromUrl(url)}`,
        metadata: { url, minViews, platform, error }
      });
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: {
          action: "social_audit.connected_accounts",
          module: "social_audit",
          provider: "apify",
          platform: accounts[0]?.platform || "Instagram",
          maxResults: Math.max(100, accounts.length * 100)
        },
        description: "Reserve credits for connected social audit batch.",
        metadata: { accountCount: accounts.length, accounts: accounts.map((account) => ({ platform: account.platform, handle: account.handle })) }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Connected social audit blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed" });
      return billingErrorResponse(error);
    }
    const audits = [];
    let apifySuccessCount = 0;
    for (const account of accounts) {
      const platform = account.platform as Platform;
      let normalized: Omit<CompetitorResult, "id" | "workspaceId" | "competitorId" | "platform" | "capturedAt">[];
      let source: "apify" | "fallback" = "apify";
      let error = "";
      try {
        const apifyItems = await scanSocialUrl(account.url, 0);
        apifySuccessCount += 1;
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
    if (apifySuccessCount > 0) {
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Charged connected social audit batch.",
        metadata: { accountCount: accounts.length, apifySuccessCount }
      });
    } else {
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Released connected social audit batch reservation because all scans used fallback.",
        metadata: { accountCount: accounts.length }
      });
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

    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: {
          action: "research.url_scan",
          module: "research",
          provider: "apify",
          platform,
          maxResults: 100
        },
        description: `Reserve credits for Research URL scan: ${url}`,
        metadata: { url, minViews, platform }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Research URL scan blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed" });
      return billingErrorResponse(error);
    }

    let runMeta: Awaited<ReturnType<typeof startSocialUrlScanRun>> | null = null;
    let startError = "";
    try {
      runMeta = await startSocialUrlScanRun(url, minViews);
    } catch (err) {
      startError = err instanceof Error ? err.message : "Apify scan failed to start";
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: `Released Research URL scan reservation because Apify failed to start: ${url}`,
        metadata: { error: startError, url, minViews, platform }
      });
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
    if (runMeta) {
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: scan.id,
        providerTaskId: runMeta.runId,
        description: `Charged Research URL scan start for ${handleFromUrl(url)}.`,
        metadata: { scanId: scan.id, runId: runMeta.runId, datasetId: runMeta.datasetId, actorId: runMeta.actorId }
      });
    }
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: {
          action: "research.keyword_search",
          module: "research",
          provider: "apify",
          platform: selectedPlatform,
          maxResults: 100
        },
        description: `Reserve credits for keyword Research: ${query}`,
        metadata: { query, minViews, dimensions, selectedPlatform }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Keyword Research blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed" });
      return billingErrorResponse(error);
    }
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
        await settlePaidAction({
          workspaceId,
          reservationId: billing.reservationId,
          relatedId: scan.id,
          description: `Charged keyword Research fallback for "${query}".`,
          metadata: { scanId: scan.id, query, selectedPlatform, fallback: true }
        });
        return NextResponse.json(scan);
      } catch (err) {
        startError = err instanceof Error ? `${startError}; fallback failed: ${err.message}` : `${startError}; fallback failed`;
        await releasePaidAction({
          workspaceId,
          reservationId: billing.reservationId,
          description: `Released keyword Research reservation because Apify failed: ${query}`,
          metadata: { error: startError, query, selectedPlatform }
        });
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
    if (runMeta) {
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: scan.id,
        providerTaskId: runMeta.runId,
        description: `Charged keyword Research start for "${query}".`,
        metadata: { scanId: scan.id, runId: runMeta.runId, datasetId: runMeta.datasetId, actorId: runMeta.actorId, selectedPlatform }
      });
    }
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: generationBillingInput("research.create_content_plan", "research", "text", "gemini-3.5-flash", undefined, { inputTokens: 2500, outputTokens: 1400 }),
        relatedId: result.id,
        description: `Reserve credits for Gemini content plan from research: ${result.title}`,
        metadata: { resultId: result.id, sourceUrl: result.url, platform: result.platform }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Research content plan generation blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed", details: { resultId: result.id } });
      return billingErrorResponse(error);
    }
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
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: result.id,
        description: `Charged Gemini content plan from research: ${result.title}`,
        metadata: { resultId: result.id, model: "gemini-3.5-flash" }
      });
    } catch (error) {
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: result.id,
        description: `Released Gemini content plan reservation after fallback: ${result.title}`,
        metadata: { resultId: result.id, error: error instanceof Error ? error.message : "Gemini content plan failed" }
      });
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
    let publishBilling: Awaited<ReturnType<typeof reservePaidAction>> | null = null;
    try {
      const snapshot = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) throw new Error("Publish queue item not found.");
        if (item.status === "generating") throw new Error("This draft is still generating.");
        return { item, asset: db.assets.find((asset) => asset.id === item.assetId && asset.workspaceId === workspaceId) };
      });
      const description = publishDescription(snapshot.item, snapshot.asset);
      publishBilling = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: { action: "publish.now", module: "publish", provider: "upload-post", posts: 1 },
        relatedId: snapshot.item.id,
        description: `Billing check for Upload-Post publish: ${snapshot.item.title}`,
        metadata: { publishId: snapshot.item.id, platform: snapshot.item.platform }
      });
      await debugLog(workspaceId, {
        action,
        label: `Publish payload sent to Upload-Post: ${snapshot.item.title}`,
        status: "started",
        provider: "upload-post",
        prompt: description,
        details: { publishId: snapshot.item.id, platform: snapshot.item.platform, hasAssetUrl: Boolean(snapshot.asset?.assetUrl) }
      });
      const result = await sendToUploadPost(snapshot.item, snapshot.asset);
      await settlePaidAction({
        workspaceId,
        reservationId: publishBilling.reservationId,
        relatedId: snapshot.item.id,
        providerTaskId: result.request_id || result.job_id,
        description: `Settled Upload-Post publish: ${snapshot.item.title}`,
        metadata: { publishId: snapshot.item.id, platform: snapshot.item.platform }
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
      await releasePaidAction({
        workspaceId,
        reservationId: publishBilling?.reservationId,
        description: "Released Upload-Post publish reservation after failure.",
        metadata: { error: error instanceof Error ? error.message : "Upload-Post publish failed" }
      }).catch(() => null);
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: generationBillingInput("create_content.ai_assist", "create_content", "text", "gpt-5-5", undefined, { inputTokens: 2200, outputTokens: 1400 }),
        description: "Reserve credits for Create Content AI field-fill.",
        metadata: { idea, requestedFormat: requestedFormat || undefined, requestedDuration, requestedModel: requestedModel || undefined }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Create Content AI field-fill blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed" });
      return billingErrorResponse(error);
    }
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
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Charged Create Content AI field-fill.",
        metadata: { model: "gpt-5-5", topic: draft.topic, format: draft.format }
      });
      return NextResponse.json(draft);
    } catch (error) {
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Released Create Content AI field-fill reservation after Kie failure.",
        metadata: { error: error instanceof Error ? error.message : "Kie GPT-5.5 generation failed" }
      });
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: generationBillingInput("research.refine_video_prompt", "research", "text", "gpt-5-5", undefined, { inputTokens: 2500, outputTokens: 1200 }),
        description: "Reserve credits for Research final video prompt generation.",
        metadata: { sourceUrl: String(body.sourceUrl || ""), generationModel: String(body.generationModel || "") }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Research video prompt refinement blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed" });
      return billingErrorResponse(error);
    }
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
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Charged Research final video prompt generation.",
        metadata: { model: "gpt-5-5", characters: refined.videoPrompt.length }
      });
      return NextResponse.json(refined);
    } catch (error) {
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Released Research video prompt refinement reservation after Kie failure.",
        metadata: { error: error instanceof Error ? error.message : "Kie GPT-5.5 video prompt failed" }
      });
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
    const generationType: "video" | "image" | "text" = String(snapshot.publishItem?.generationType || asset.type) === "text"
      ? "text"
      : isKieImageModel(model) ? "image" : "video";
    const references = generationType === "text" ? [] : asset.assetReferences || [];
    const duration = Number(settings.duration || snapshot.publishItem?.duration || 8);
    const aspectRatio = String(settings.aspectRatio || "9:16");
    const prompt = generationType === "video"
      ? enhanceVideoPromptForProvider({
        prompt: asset.prompt || asset.title,
        model,
        duration,
        aspectRatio,
        references
      })
      : asset.prompt || asset.title;
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: generationBillingInput(
          "create_content.generate",
          "create_content",
          generationType,
          model,
          duration
        ),
        relatedId: asset.id,
        description: `Reserve credits to start ${model} generation for ${asset.title}.`,
        metadata: {
          assetId: asset.id,
          publishItemId: snapshot.publishItem?.id,
          model,
          duration: settings.duration || snapshot.publishItem?.duration,
          aspectRatio: settings.aspectRatio
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing check failed";
      await mutateDb((db) => {
        const existing = db.assets.find((item) => item.id === asset.id && item.workspaceId === workspaceId);
        if (existing) {
          existing.status = "failed";
          existing.error = message;
        }
        db.publishQueue
          .filter((item) => item.assetId === asset.id && item.workspaceId === workspaceId)
          .forEach((item) => {
            item.status = "failed";
            item.error = message;
          });
      });
      await debugLog(workspaceId, { action, label: `Kie generation blocked by billing: ${asset.title}`, status: "failed", provider: "system", error: message, details: { assetId: asset.id, model } });
      return billingErrorResponse(error);
    }
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
      if (generationType === "text") {
        const generatedText = await generateTextContentWithKie(prompt, {
          model,
          caption: snapshot.publishItem?.caption,
          hashtags: snapshot.publishItem?.hashtags
        });
        const bodyText = [generatedText.body || generatedText.caption, generatedText.hashtags.join(" ")].filter(Boolean).join("\n\n");
        const textAssetUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(bodyText)}`;
        const providerTaskId = `text_${asset.id}`;
        const updated = await mutateDb((db) => {
          const existing = db.assets.find((item) => item.id === asset.id && item.workspaceId === workspaceId);
          if (!existing) return asset;
          existing.status = "ready";
          existing.progress = 100;
          existing.providerTaskId = providerTaskId;
          existing.generationModel = model;
          existing.assetUrl = textAssetUrl;
          existing.prompt = prompt;
          existing.generationSettings = {
            ...(existing.generationSettings || {}),
            textProviderModel: model,
            textRawResponse: generatedText.raw
          };
          db.publishQueue
            .filter((item) => item.assetId === existing.id && item.workspaceId === workspaceId)
            .forEach((item) => {
              item.status = "done";
              item.providerRequestId = providerTaskId;
              item.assetUrl = textAssetUrl;
              item.caption = generatedText.caption || generatedText.body || item.caption;
              item.hashtags = generatedText.hashtags.length ? generatedText.hashtags : item.hashtags;
              item.prompt = prompt;
              item.generationSettings = {
                ...(item.generationSettings || {}),
                textProviderModel: model,
                textRawResponse: generatedText.raw
              };
            });
          db.activity.push({ id: id("act"), workspaceId, message: `Kie text ready for "${asset.title}".`, createdAt: new Date().toISOString() });
          return existing;
        });
        await settlePaidAction({
          workspaceId,
          reservationId: billing.reservationId,
          relatedId: asset.id,
          providerTaskId,
          description: `Charged ${model} text generation for ${asset.title}.`,
          metadata: { assetId: asset.id, model, providerTaskId, characters: bodyText.length }
        });
        await debugLog(workspaceId, {
          action,
          label: `Kie text generated: ${asset.title}`,
          status: "success",
          provider: "kie",
          prompt,
          details: { assetId: asset.id, model, providerTaskId, characters: bodyText.length }
        });
        return NextResponse.json(updated);
      }
      const taskId = generationType === "image"
        ? await generateImage(prompt, { model, aspectRatio: String(settings.aspectRatio || ""), references })
        : model === "seedance-2.0"
          ? await generateSeedanceVideo(prompt, { duration, aspectRatio, references })
          : await generateVeoVideo(prompt, { duration, aspectRatio, references });
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
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: asset.id,
        providerTaskId: taskId,
        description: `Charged ${model} generation start for ${asset.title}.`,
        metadata: { assetId: asset.id, model, taskId }
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
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: asset.id,
        description: `Released ${model} generation reservation after Kie start failure.`,
        metadata: { assetId: asset.id, model, error: error instanceof Error ? error.message : "Kie generation failed" }
      });
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
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: generationBillingInput("persona.autofill", "persona", "text", "gpt-5-5", undefined, { inputTokens: 2500, outputTokens: 1200 }),
        description: "Reserve credits for Persona auto-fill GPT mapping.",
        metadata: { sourceUrls }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Persona auto-fill blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed" });
      return billingErrorResponse(error);
    }
    await debugLog(workspaceId, {
      action,
      label: "Persona auto-fill crawl started",
      status: "started",
      provider: "apify",
      details: { sourceUrls }
    });
    try {
      let crawled: Awaited<ReturnType<typeof crawlPersonaSourcesWithApify>>;
      let crawlFallbackReason = "";
      try {
        crawled = await crawlPersonaSourcesWithApify(sourceUrls);
      } catch (error) {
        crawlFallbackReason = error instanceof Error ? error.message : "Apify persona crawl failed";
        crawled = fallbackPersonaCrawlFromUrls(sourceUrls);
        await debugLog(workspaceId, {
          action,
          label: "Persona auto-fill Apify crawl fallback used",
          status: "failed",
          provider: "apify",
          error: crawlFallbackReason,
          details: { sourceUrls, fallbackSources: crawled.map((item) => ({ source: item.source, itemCount: item.itemCount })) }
        });
      }
      const prompt = buildPersonaAutofillPrompt({ current: existing, crawled });
      await debugLog(workspaceId, {
        action,
        label: crawlFallbackReason ? "Prompt sent to Kie GPT-5.5 for persona auto-fill with URL fallback" : "Prompt sent to Kie GPT-5.5 for persona auto-fill",
        status: "started",
        provider: "kie",
        prompt,
        details: { model: "gpt-5-5", crawlFallbackReason, crawledSources: crawled.map((item) => ({ source: item.source, itemCount: item.itemCount })) }
      });
      let compactGenerated: Record<string, unknown>;
      let usedFallback = false;
      try {
        const generated = await generatePersonaAutofillWithGpt55(prompt) as Record<string, unknown>;
        const providerError = providerErrorFromJson(generated);
        if (providerError) throw new Error(providerError);
        compactGenerated = compactAutofillOutput(generated);
        await settlePaidAction({
          workspaceId,
          reservationId: billing.reservationId,
          description: "Charged Persona auto-fill GPT mapping.",
          metadata: { model: "gpt-5-5", crawlFallbackReason, generated: compactGenerated }
        });
      } catch (error) {
        compactGenerated = fallbackPersonaFromCrawl(existing, crawled);
        usedFallback = true;
        await releasePaidAction({
          workspaceId,
          reservationId: billing.reservationId,
          description: "Released Persona auto-fill GPT reservation because Kie failed and local fallback was used.",
          metadata: { error: error instanceof Error ? error.message : "Kie persona auto-fill failed", crawlFallbackReason }
        });
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
        db.activity.push({ id: id("act"), workspaceId, message: crawlFallbackReason ? `Persona auto-filled from public URLs because Apify crawl was unavailable.` : `Persona auto-filled from ${crawled.length} public source(s).`, createdAt: new Date().toISOString() });
        return merged;
      });
      await debugLog(workspaceId, {
        action,
        label: "Persona auto-fill completed",
        status: "success",
        provider: usedFallback ? "system" : "kie",
        details: { model: "gpt-5-5", usedFallback, crawlFallbackReason, displayName: profile.displayName, company: profile.company }
      });
      return NextResponse.json(profile);
    } catch (error) {
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        description: "Released Persona auto-fill reservation after failure.",
        metadata: { error: error instanceof Error ? error.message : "Persona auto-fill failed" }
      }).catch(() => null);
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
    const allowed = await mutateDb((db) => hasPermission(db, user, "prompts.edit"));
    if (!allowed) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }
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

  if (action === "runSourceWatcherNow") {
    const watcher = await mutateDb((db) => (db.automationSourceWatchers || []).find((item) => item.id === body.id && item.workspaceId === workspaceId) || null);
    if (!watcher) return NextResponse.json({ error: "Source watcher not found." }, { status: 404 });
    const startedAt = new Date().toISOString();
    let crawlBilling;
    try {
      crawlBilling = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: {
          action: "automation.source_watcher_scan",
          module: "automation",
          provider: "apify",
          platform: watcher.sourceUrls[0] ? platformFromUrl(watcher.sourceUrls[0]) : "Instagram",
          maxResults: Math.max(100, watcher.sourceUrls.length * 100)
        },
        relatedId: watcher.id,
        description: `Reserve credits for Source Watcher crawl: ${watcher.name}`,
        metadata: { watcherId: watcher.id, sourceUrls: watcher.sourceUrls, minViews: watcher.minViews }
      });
    } catch (error) {
      await debugLog(workspaceId, { action, label: "Source Watcher blocked by billing", status: "failed", provider: "system", error: error instanceof Error ? error.message : "Billing check failed", details: { watcherId: watcher.id } });
      return billingErrorResponse(error);
    }
    await debugLog(workspaceId, {
      action,
      label: `Source Watcher crawl started: ${watcher.name}`,
      status: "started",
      provider: "apify",
      details: { watcherId: watcher.id, sourceUrls: watcher.sourceUrls, minViews: watcher.minViews, contentType: watcher.contentType }
    });
    const candidates: SourceWatcherCandidate[] = [];
    const errors: string[] = [];
    let apifySuccessCount = 0;
    for (const sourceUrl of watcher.sourceUrls) {
      try {
        const platform = platformFromUrl(sourceUrl);
        const items = await scanSocialUrl(sourceUrl, watcher.minViews);
        apifySuccessCount += 1;
        for (const item of items) {
          const base = {
            id: id("res"),
            platform,
            sourceUrl,
            url: item.sourceUrl,
            title: item.title,
            description: item.description,
            thumbnailUrl: item.thumbnailUrl,
            mediaUrl: item.mediaUrl,
            mediaType: item.mediaType,
            views: item.views,
            likes: item.likes,
            comments: item.comments,
            publishedAt: item.publishedAt,
            duration: item.duration
          };
          candidates.push({ ...base, score: sourceWatcherScore(base, watcher.rankingMode) });
        }
      } catch (error) {
        errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : "crawl failed"}`);
      }
    }
    if (apifySuccessCount > 0) {
      await settlePaidAction({
        workspaceId,
        reservationId: crawlBilling.reservationId,
        relatedId: watcher.id,
        description: `Charged Source Watcher crawl: ${watcher.name}`,
        metadata: { watcherId: watcher.id, scannedUrls: watcher.sourceUrls.length, apifySuccessCount, candidateCount: candidates.length }
      });
    } else {
      await releasePaidAction({
        workspaceId,
        reservationId: crawlBilling.reservationId,
        relatedId: watcher.id,
        description: `Released Source Watcher crawl reservation because Apify did not return any scan: ${watcher.name}`,
        metadata: { watcherId: watcher.id, errors }
      });
    }
    const filtered = candidates
      .filter((item) => watcher.contentType === "auto" || sourceWatcherKind(item, watcher.contentType) === watcher.contentType)
      .sort((a, b) => b.score - a.score);
    const personaContext = await mutateDb((db) => buildPersonaContext(db.personaProfiles.find((item) => item.workspaceId === workspaceId)));
    const result = await mutateDb((db) => {
      db.automationSourceRuns ||= [];
      db.competitorResults ||= [];
      db.assets ||= [];
      db.publishQueue ||= [];
      const run: AutomationSourceRun = {
        id: id("srun"),
        workspaceId,
        watcherId: watcher.id,
        status: "running",
        sourceUrls: watcher.sourceUrls,
        scannedCount: candidates.length,
        startedAt
      };
      const storedResults: CompetitorResult[] = candidates.slice(0, 40).map((candidate) => ({
        id: candidate.id,
        workspaceId,
        competitorId: watcher.id,
        platform: candidate.platform,
        url: candidate.url,
        title: candidate.title,
        thumbnailUrl: candidate.thumbnailUrl || "",
        mediaUrl: candidate.mediaUrl,
        mediaType: candidate.mediaType,
        description: candidate.description,
        views: candidate.views,
        likes: candidate.likes,
        comments: candidate.comments,
        publishedAt: candidate.publishedAt || startedAt,
        duration: candidate.duration,
        capturedAt: startedAt
      }));
      db.competitorResults.push(...storedResults);
      const watcherRecord = (db.automationSourceWatchers || []).find((item) => item.id === watcher.id && item.workspaceId === workspaceId);
      const firstUsable = filtered.find((candidate) => !sourceWatcherDuplicate(watcher, candidate, db, workspaceId).duplicate);
      if (!firstUsable) {
        const duplicate = filtered[0] ? sourceWatcherDuplicate(watcher, filtered[0], db, workspaceId) : null;
        run.status = "no-match";
        run.completedAt = new Date().toISOString();
        run.selectionReason = filtered.length ? `No suitable non-duplicate source found. Best duplicate score was ${Math.round((duplicate?.best.score || 0) * 100)}%.` : "No source results matched the watcher filters.";
        if (watcherRecord) {
          watcherRecord.lastRunAt = run.completedAt;
          watcherRecord.nextRunAt = sourceWatcherNextRunAt(watcherRecord.frequency, watcherRecord.postingTime);
          watcherRecord.updatedAt = run.completedAt;
        }
        db.automationSourceRuns.push(run);
        db.activity.push({ id: id("act"), workspaceId, message: `Source Watcher found no usable content for "${watcher.name}".`, createdAt: run.completedAt });
        return { run, publishItem: null, asset: null, selected: null };
      }
      const selected = firstUsable;
      const generationType = sourceWatcherKind(selected, watcher.contentType);
      const model = modelForResolvedSourceWatcherKind(watcher.model, generationType);
      const references = sourceWatcherReferences(watcher);
      const basePrompt = sourceWatcherPrompt({ watcher, candidate: selected, generationType, personaContext });
      const prompt = generationType === "video"
        ? enhanceVideoPromptForProvider({ prompt: enrichPromptWithAssetReferences(basePrompt, generationType, references), model, duration: watcher.duration || selected.duration || 8, aspectRatio: watcher.aspectRatio, references })
        : enrichPromptWithAssetReferences(basePrompt, generationType, references);
      const caption = selected.description || `Inspired by a high-performing ${selected.platform} source: ${selected.title}`;
      const hashtags = ["#ContentAgent", `#${selected.platform.replace(/\s+/g, "")}`];
      const isKieVideo = generationType === "video" && (model === "veo-fast" || model === "seedance-2.0");
      const isKieImage = generationType === "image" && isKieImageModel(model);
      const isKieGeneration = isKieVideo || isKieImage;
      const now = new Date().toISOString();
      const generationSettings = { aspectRatio: watcher.aspectRatio, duration: generationType === "video" ? closestVideoDuration(watcher.duration || selected.duration || 8, model) : undefined, sourceWatcherId: watcher.id };
      const asset: Asset = {
        id: id("ast"),
        workspaceId,
        briefId: "source-watcher",
        title: `Source Watcher: ${selected.title}`.slice(0, 120),
        type: generationType === "video" ? "video" : generationType === "image" ? "image" : "text",
        status: isKieGeneration ? "queued" : "ready",
        progress: isKieGeneration ? 10 : 100,
        createdAt: now,
        provider: isKieGeneration ? "kie" : "local",
        generationModel: model,
        generationSettings,
        prompt,
        assetReferences: references,
        sourceUrl: selected.url,
        sourceTitle: selected.title,
        sourceThumbnailUrl: selected.thumbnailUrl,
        sourceMediaUrl: selected.mediaUrl,
        sourceMediaType: selected.mediaType,
        assetUrl: isKieGeneration ? undefined : generationType === "video" ? demoVideoUrl : generationType === "text" ? `data:text/plain;charset=utf-8,${encodeURIComponent(`${caption}\n\n${hashtags.join(" ")}`)}` : undefined
      };
      db.assets.push(asset);
      const publishItem: PublishItem = {
        id: id("pub"),
        workspaceId,
        assetId: asset.id,
        title: asset.title,
        platform: selected.platform,
        scheduledAt: now,
        status: isKieGeneration ? "generating" : watcher.approvalMode === "auto-schedule" ? "scheduled" : watcher.approvalMode === "auto-publish" && generationType === "text" ? "draft" : "done",
        provider: isKieGeneration ? "kie" : "local",
        caption,
        hashtags,
        generationModel: model,
        generationType,
        generationSettings,
        duration: generationType === "video" ? Number(generationSettings.duration || 8) : undefined,
        prompt,
        assetReferences: references,
        sourceUrl: selected.url,
        sourceTitle: selected.title,
        sourceThumbnailUrl: selected.thumbnailUrl,
        sourceMediaUrl: selected.mediaUrl,
        sourceMediaType: selected.mediaType,
        assetUrl: asset.assetUrl,
        createdAt: now
      };
      db.publishQueue.push(publishItem);
      run.status = "completed";
      run.completedAt = now;
      run.selectedResultId = selected.id;
      run.selectedTitle = selected.title;
      run.selectedUrl = selected.url;
      run.selectedScore = selected.score;
      run.selectionReason = `Selected by ${watcher.rankingMode} ranking from ${candidates.length} crawled result${candidates.length === 1 ? "" : "s"}.`;
      run.publishItemId = publishItem.id;
      run.assetId = asset.id;
      db.automationSourceRuns.push(run);
      if (watcherRecord) {
        watcherRecord.lastRunAt = now;
        watcherRecord.nextRunAt = sourceWatcherNextRunAt(watcherRecord.frequency, watcherRecord.postingTime);
        watcherRecord.updatedAt = now;
        watcherRecord.lastError = "";
      }
      db.activity.push({ id: id("act"), workspaceId, message: `Source Watcher selected "${selected.title}" and created a My Contents item.`, createdAt: now });
      return { run, publishItem, asset, selected };
    });
    await debugLog(workspaceId, {
      action,
      label: `Source Watcher crawl completed: ${watcher.name}`,
      status: result.run.status === "failed" ? "failed" : "success",
      provider: "apify",
      prompt: result.publishItem?.prompt,
      details: { watcherId: watcher.id, scannedCount: candidates.length, selected: result.selected, errors }
    });
    if (result.asset?.provider === "kie" && result.publishItem) {
      const model = result.asset.generationModel || watcher.model;
      const settings = result.asset.generationSettings || {};
      let generationBilling;
      try {
        generationBilling = await reservePaidAction({
          workspaceId,
          userId: user.id,
          quoteInput: generationBillingInput(
            "automation.source_watcher_generate",
            "automation",
            result.publishItem.generationType || (isKieImageModel(model) ? "image" : "video"),
            model,
            Number(settings.duration || 8)
          ),
          relatedId: result.asset.id,
          description: `Reserve credits for Source Watcher ${model} generation: ${watcher.name}`,
          metadata: { watcherId: watcher.id, assetId: result.asset.id, publishItemId: result.publishItem.id, model }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Billing check failed";
        await mutateDb((db) => {
          const asset = db.assets.find((item) => item.id === result.asset?.id && item.workspaceId === workspaceId);
          if (asset) {
            asset.status = "failed";
            asset.error = message;
          }
          const pub = db.publishQueue.find((item) => item.id === result.publishItem?.id && item.workspaceId === workspaceId);
          if (pub) {
            pub.status = "failed";
            pub.error = message;
          }
        });
        await debugLog(workspaceId, { action, label: "Source Watcher Kie generation blocked by billing", status: "failed", provider: "system", error: message, details: { watcherId: watcher.id, assetId: result.asset.id, model } });
        return billingErrorResponse(error);
      }
      try {
        const refs = result.asset.assetReferences || [];
        const taskId = isKieImageModel(model)
          ? await generateImage(result.asset.prompt || result.asset.title, { model, aspectRatio: String(settings.aspectRatio || watcher.aspectRatio), references: refs })
          : model === "seedance-2.0"
            ? await generateSeedanceVideo(result.asset.prompt || result.asset.title, { duration: Number(settings.duration || 8), aspectRatio: String(settings.aspectRatio || watcher.aspectRatio), references: refs })
            : await generateVeoVideo(result.asset.prompt || result.asset.title, { duration: Number(settings.duration || 8), aspectRatio: String(settings.aspectRatio || watcher.aspectRatio), references: refs });
        const updated = await mutateDb((db) => {
          const asset = db.assets.find((item) => item.id === result.asset?.id && item.workspaceId === workspaceId);
          if (asset) {
            asset.providerTaskId = taskId;
            asset.status = "rendering";
            asset.progress = 35;
          }
          const pub = db.publishQueue.find((item) => item.id === result.publishItem?.id && item.workspaceId === workspaceId);
          if (pub) pub.providerRequestId = taskId;
          db.activity.push({ id: id("act"), workspaceId, message: `Source Watcher Kie task started: ${taskId}`, createdAt: new Date().toISOString() });
          return { asset, publishItem: pub };
        });
        await settlePaidAction({
          workspaceId,
          reservationId: generationBilling.reservationId,
          relatedId: result.asset.id,
          providerTaskId: taskId,
          description: `Charged Source Watcher ${model} generation start: ${watcher.name}`,
          metadata: { watcherId: watcher.id, assetId: result.asset.id, publishItemId: result.publishItem.id, model, taskId }
        });
        await debugLog(workspaceId, {
          action,
          label: `Source Watcher Kie task started: ${taskId}`,
          status: "success",
          provider: "kie",
          prompt: result.asset.prompt,
          details: { model, taskId, watcherId: watcher.id, publishItemId: result.publishItem.id }
        });
        return NextResponse.json({ ...result, ...updated });
      } catch (error) {
        await releasePaidAction({
          workspaceId,
          reservationId: generationBilling.reservationId,
          relatedId: result.asset.id,
          description: `Released Source Watcher ${model} generation reservation after Kie failure.`,
          metadata: { watcherId: watcher.id, assetId: result.asset.id, model, error: error instanceof Error ? error.message : "Kie generation failed" }
        });
        const failed = await mutateDb((db) => {
          const asset = db.assets.find((item) => item.id === result.asset?.id && item.workspaceId === workspaceId);
          if (asset) {
            asset.status = "failed";
            asset.error = error instanceof Error ? error.message : "Kie generation failed";
          }
          const pub = db.publishQueue.find((item) => item.id === result.publishItem?.id && item.workspaceId === workspaceId);
          if (pub) {
            pub.status = "failed";
            pub.error = asset?.error || "Kie generation failed";
          }
          return { asset, publishItem: pub };
        });
        await debugLog(workspaceId, {
          action,
          label: "Source Watcher Kie generation failed",
          status: "failed",
          provider: "kie",
          prompt: result.asset.prompt,
          error: error instanceof Error ? error.message : "Kie generation failed"
        });
        return NextResponse.json({ ...result, ...failed }, { status: 502 });
      }
    }
    if (watcher.approvalMode === "auto-publish" && result.publishItem && result.publishItem.generationType === "text") {
      try {
        const upload = await sendToUploadPost(result.publishItem, result.asset || undefined);
        const updated = await mutateDb((db) => {
          const item = db.publishQueue.find((queue) => queue.id === result.publishItem?.id && queue.workspaceId === workspaceId);
          if (item) {
            item.status = "published";
            item.provider = "upload-post";
            item.providerRequestId = upload.request_id || upload.job_id;
          }
          return item;
        });
        return NextResponse.json({ ...result, publishItem: updated || result.publishItem });
      } catch (error) {
        await debugLog(workspaceId, { action, label: "Source Watcher Upload-Post publish failed", status: "failed", provider: "upload-post", error: error instanceof Error ? error.message : "Upload-Post publish failed" });
        return NextResponse.json(result);
      }
    }
    return NextResponse.json(result);
  }

  const data = await mutateDb((db) => {
    const activity = (message: string) => db.activity.push({ id: id("act"), workspaceId, message, createdAt: new Date().toISOString() });

    if (action === "createAutomationRule") {
      db.automationRules ||= [];
      db.automationJobs ||= [];
      const now = new Date().toISOString();
      const frequency = (["daily", "weekly", "custom"].includes(String(body.frequency)) ? String(body.frequency) : "weekly") as AutomationRule["frequency"];
      const duplicateMode = (["off", "light", "standard", "strict"].includes(String(body.duplicateMode)) ? String(body.duplicateMode) : "standard") as AutomationRule["duplicateProtection"]["mode"];
      const contentType = (["image", "short-video", "long-video", "text"].includes(String(body.contentType)) ? String(body.contentType) : "image") as AutomationRule["contentType"];
      const aspectRatio = normalizeAutomationAspectRatio(contentType, body.aspectRatio) as AutomationRule["aspectRatio"];
      const model = normalizeAutomationModel(contentType, body.model);
      const referenceAssets = parseAssetReferences(body.referenceAssets);
      const platformsInput = normalizeStringList(body.platforms).filter((item): item is Platform => allowedPlatforms.includes(item as Platform));
      const rule: AutomationRule = {
        id: id("auto"),
        workspaceId,
        name: String(body.name || "Untitled automation").trim() || "Untitled automation",
        instruction: String(body.instruction || "").trim(),
        goal: (["leads", "awareness", "engagement", "authority", "sales"].includes(String(body.goal)) ? String(body.goal) : "leads") as AutomationRule["goal"],
        platforms: platformsInput.length ? platformsInput : ["Facebook"],
        contentType,
        aspectRatio,
        model,
        frequency,
        postingDays: normalizeStringList(body.postingDays).length ? normalizeStringList(body.postingDays) : ["Mon", "Wed", "Fri"],
        postingTime: String(body.postingTime || "10:00"),
        timezone: String(body.timezone || "Asia/Kuala_Lumpur"),
        quantityPerRun: clampNumber(body.quantityPerRun, 1, 1, 5),
        approvalMode: (["draft-only", "generate-and-wait", "auto-schedule", "auto-publish"].includes(String(body.approvalMode)) ? String(body.approvalMode) : "draft-only") as AutomationRule["approvalMode"],
        researchMode: (["latest-research", "keywords", "none"].includes(String(body.researchMode)) ? String(body.researchMode) : "keywords") as AutomationRule["researchMode"],
        keywords: parseList(body.keywords).slice(0, 20),
        sourceUrls: parseList(body.sourceUrls).slice(0, 20),
        restrictions: String(body.restrictions || "").trim(),
        duplicateProtection: {
          mode: duplicateMode,
          sourceWindowDays: clampNumber(body.sourceWindowDays, duplicateMode === "strict" ? 180 : 90, 1, 365),
          topicWindowDays: clampNumber(body.topicWindowDays, duplicateMode === "strict" ? 120 : 45, 1, 365),
          similarityThreshold: clampNumber(body.similarityThreshold, duplicateMode === "strict" ? 76 : 82, 50, 98),
          maxRetries: clampNumber(body.maxRetries, duplicateMode === "off" ? 0 : 2, 0, 5)
        },
        referenceAssets,
        status: "active",
        nextRunAt: nextAutomationRunAt(frequency, String(body.postingTime || "10:00")),
        createdAt: now,
        updatedAt: now
      };
      if (!rule.instruction) throw new Error("Automation instruction is required.");
      db.automationRules.push(rule);
      activity(`Automation rule saved: ${rule.name}`);
      return rule;
    }

    if (action === "createSourceWatcher") {
      db.automationSourceWatchers ||= [];
      db.automationSourceRuns ||= [];
      const now = new Date().toISOString();
      const sourceUrls = parseList(body.sourceUrls).filter((url) => /^https?:\/\/.+\..+/.test(url)).slice(0, 20);
      if (sourceUrls.length === 0) throw new Error("Add at least one valid social media source URL.");
      const frequency = (["daily", "weekly", "custom"].includes(String(body.frequency)) ? String(body.frequency) : "daily") as AutomationSourceWatcher["frequency"];
      const contentType = (["auto", "video", "image", "text"].includes(String(body.contentType)) ? String(body.contentType) : "auto") as AutomationSourceWatcher["contentType"];
      const aspectRatio = normalizeAutomationAspectRatio(contentType, body.aspectRatio) as AutomationSourceWatcher["aspectRatio"];
      const model = normalizeAutomationModel(contentType, body.model);
      const referenceAssets = parseAssetReferences(body.referenceAssets);
      const watcher: AutomationSourceWatcher = {
        id: id("watch"),
        workspaceId,
        name: String(body.name || "Source Watcher").trim() || "Source Watcher",
        sourceUrls,
        instruction: String(body.instruction || "Recreate the best source content for my brand and persona.").trim(),
        contentType,
        model,
        aspectRatio,
        duration: contentType === "video" || contentType === "auto" ? closestVideoDuration(body.duration || 8, model === "auto" ? "veo-fast" : model) : undefined,
        minViews: clampNumber(body.minViews, 0, 0, 1000000000),
        rankingMode: (["balanced", "views", "engagement", "recent"].includes(String(body.rankingMode)) ? String(body.rankingMode) : "balanced") as AutomationSourceWatcher["rankingMode"],
        frequency,
        postingDays: normalizeStringList(body.postingDays).length ? normalizeStringList(body.postingDays) : ["Mon", "Wed", "Fri"],
        postingTime: String(body.postingTime || "10:00"),
        timezone: String(body.timezone || "Asia/Kuala_Lumpur"),
        approvalMode: (["draft-only", "generate-and-wait", "auto-schedule", "auto-publish"].includes(String(body.approvalMode)) ? String(body.approvalMode) : "draft-only") as AutomationSourceWatcher["approvalMode"],
        referenceUrls: {
          logo: String(body.logoUrl || "").trim() || undefined,
          productPhoto: String(body.productPhotoUrl || "").trim() || undefined,
          avatar: String(body.avatarUrl || "").trim() || undefined,
          audio: String(body.audioUrl || "").trim() || undefined
        },
        referenceAssets,
        duplicateProtection: {
          sourceWindowDays: clampNumber(body.sourceWindowDays, 90, 1, 365),
          topicWindowDays: clampNumber(body.topicWindowDays, 45, 1, 365),
          similarityThreshold: clampNumber(body.similarityThreshold, 82, 50, 98)
        },
        status: "active",
        nextRunAt: sourceWatcherNextRunAt(frequency, String(body.postingTime || "10:00")),
        createdAt: now,
        updatedAt: now
      };
      db.automationSourceWatchers.push(watcher);
      activity(`Source Watcher saved: ${watcher.name}`);
      return watcher;
    }

    if (action === "pauseSourceWatcher" || action === "resumeSourceWatcher" || action === "deleteSourceWatcher") {
      db.automationSourceWatchers ||= [];
      const watcher = db.automationSourceWatchers.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!watcher) throw new Error("Source watcher not found.");
      if (action === "deleteSourceWatcher") {
        db.automationSourceWatchers = db.automationSourceWatchers.filter((item) => item.id !== watcher.id);
        activity(`Source Watcher deleted: ${watcher.name}`);
        return { id: watcher.id, deleted: true };
      }
      watcher.status = action === "pauseSourceWatcher" ? "paused" : "active";
      watcher.updatedAt = new Date().toISOString();
      activity(`Source Watcher ${watcher.status}: ${watcher.name}`);
      return watcher;
    }

    if (action === "pauseAutomationRule" || action === "resumeAutomationRule" || action === "deleteAutomationRule") {
      db.automationRules ||= [];
      const rule = db.automationRules.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!rule) throw new Error("Automation rule not found.");
      if (action === "deleteAutomationRule") {
        db.automationRules = db.automationRules.filter((item) => item.id !== rule.id);
        activity(`Automation deleted: ${rule.name}`);
        return { id: rule.id, deleted: true };
      }
      rule.status = action === "pauseAutomationRule" ? "paused" : "active";
      rule.updatedAt = new Date().toISOString();
      activity(`Automation ${rule.status}: ${rule.name}`);
      return rule;
    }

    if (action === "runAutomationNow") {
      db.automationRules ||= [];
      db.automationJobs ||= [];
      const rule = db.automationRules.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!rule) throw new Error("Automation rule not found.");
      const now = new Date().toISOString();
      const title = automationTitle(rule);
      const prompt = automationPrompt(rule);
      const candidateText = [title, prompt, rule.instruction, rule.keywords.join(" "), rule.sourceUrls.join(" ")].join("\n");
      const threshold = rule.duplicateProtection.similarityThreshold / 100;
      const cutoff = Date.now() - rule.duplicateProtection.topicWindowDays * 24 * 60 * 60 * 1000;
      const history = [
        ...(db.automationJobs || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt, item.caption].join("\n"), url: "", createdAt: item.createdAt })),
        ...(db.publishQueue || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt, item.caption, (item.hashtags || []).join(" ")].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt })),
        ...(db.assets || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt })),
        ...(db.competitorResults || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.description].join("\n"), url: item.url, createdAt: item.capturedAt || item.publishedAt }))
      ].filter((item) => !item.createdAt || new Date(item.createdAt).getTime() >= cutoff);
      let best = { id: "", title: "", score: 0, reason: "No close duplicate found in recent history." };
      if (rule.duplicateProtection.mode !== "off") {
        for (const item of history) {
          const score = Math.max(sourceOverlapScore(rule.sourceUrls, item.url), ideaSimilarity(candidateText, item.text));
          if (score > best.score) best = { id: item.id, title: item.title, score, reason: score >= 1 ? "Exact source URL already exists in recent history." : "Most similar recent topic found." };
        }
      }
      const duplicate = rule.duplicateProtection.mode !== "off" && best.score >= threshold;
      const job: AutomationJob = {
        id: id("job"),
        workspaceId,
        automationRuleId: rule.id,
        scheduledFor: now,
        status: duplicate ? "skipped-duplicate" : "ready-for-generation",
        title,
        prompt,
        caption: `Draft created from automation rule "${rule.name}". Review the prompt, attach assets if needed, then generate from Create Content.`,
        hashtags: rule.keywords.map(automationHashtag).filter(Boolean).slice(0, 8),
        duplicateCheck: {
          mode: rule.duplicateProtection.mode,
          checkedAt: now,
          matchedItemId: best.id || undefined,
          matchedTitle: best.title || undefined,
          similarityScore: best.score,
          reason: duplicate ? `${best.reason} Skipped because score ${Math.round(best.score * 100)}% is above ${rule.duplicateProtection.similarityThreshold}%.` : best.reason,
          attempts: 1
        },
        createdAt: now,
        updatedAt: now
      };
      db.automationJobs.push(job);
      rule.lastRunAt = now;
      rule.nextRunAt = nextAutomationRunAt(rule.frequency, rule.postingTime);
      rule.updatedAt = now;
      db.debugLogs ||= [];
      db.debugLogs.push({
        id: id("log"),
        workspaceId,
        action,
        label: "Automation duplicate check",
        status: duplicate ? "info" : "success",
        provider: "system",
        prompt,
        details: {
          ruleId: rule.id,
          ruleName: rule.name,
          duplicateMode: rule.duplicateProtection.mode,
          threshold: rule.duplicateProtection.similarityThreshold,
          bestMatch: best,
          jobStatus: job.status
        },
        createdAt: now
      });
      activity(duplicate ? `Automation skipped duplicate idea for "${rule.name}".` : `Automation draft job ready for "${rule.name}".`);
      return job;
    }

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
      const isKieText = generationType === "text" && isKieTextModel(model);
      const isKieGeneration = isKieVideo || isKieImage || isKieText;
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
      const isKieText = generationType === "text" && isKieTextModel(model);
      const isKieGeneration = isKieVideo || isKieImage || isKieText;
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
    const model = generatedAsset.generationModel || String(body.generationModel || "veo-fast");
    let billing;
    try {
      billing = await reservePaidAction({
        workspaceId,
        userId: user.id,
        quoteInput: generationBillingInput(
          action === "generateUgc" ? "create_content.generate_ugc" : "create_content.render_asset",
          "create_content",
          isKieImageModel(model) ? "image" : "video",
          model,
          Number(body.duration || generatedAsset.generationSettings?.duration || 8)
        ),
        relatedId: generatedAsset.id,
        description: `Reserve credits to start ${model} generation for ${generatedAsset.title}.`,
        metadata: { assetId: generatedAsset.id, model, action }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing check failed";
      await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === generatedAsset.id && item.workspaceId === workspaceId);
        if (asset) {
          asset.status = "failed";
          asset.error = message;
        }
      });
      await debugLog(workspaceId, { action, label: `Immediate Kie generation blocked by billing: ${generatedAsset.title}`, status: "failed", provider: "system", error: message, details: { assetId: generatedAsset.id, model } });
      return billingErrorResponse(error);
    }
    try {
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
      await settlePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: generatedAsset.id,
        providerTaskId: taskId,
        description: `Charged ${model} generation start for ${generatedAsset.title}.`,
        metadata: { assetId: generatedAsset.id, model, taskId, action }
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
      await releasePaidAction({
        workspaceId,
        reservationId: billing.reservationId,
        relatedId: generatedAsset.id,
        description: `Released ${model} generation reservation after Kie start failure.`,
        metadata: { assetId: generatedAsset.id, model, error: error instanceof Error ? error.message : "Kie generation failed", action }
      });
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
