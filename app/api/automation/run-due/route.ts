import { NextRequest, NextResponse } from "next/server";
import { id, mutateDb } from "@/lib/store";
import type { Asset, AutomationSourceRun, AutomationSourceWatcher, CompetitorResult, Database, GenerationAssetReference, Platform, PublishItem } from "@/lib/types";
import { appendPersonaContext, buildPersonaContext } from "@/lib/persona";
import { scanSocialUrl } from "@/lib/providers/apify";
import { generateImage, generateSeedanceVideo, generateVeoVideo, getMarketTask, getVeoVideo } from "@/lib/providers/kie";
import { publishPhotoPost, publishTextPost, publishVideoPost } from "@/lib/providers/uploadPost";

export const dynamic = "force-dynamic";

const allowedPlatforms: Platform[] = ["TikTok", "Instagram", "YouTube", "LinkedIn", "Facebook", "X"];

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

function authorized(req: NextRequest) {
  const secret = process.env.AUTOMATION_CRON_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("x-automation-cron-secret")?.trim() === secret || req.nextUrl.searchParams.get("secret")?.trim() === secret;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nextAutomationRunAt(frequency: AutomationSourceWatcher["frequency"], postingTime: string) {
  const now = new Date();
  const [hoursRaw, minutesRaw] = postingTime.split(":");
  const hours = clampNumber(hoursRaw, 10, 0, 23);
  const minutes = clampNumber(minutesRaw, 0, 0, 59);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + (frequency === "weekly" ? 7 : 1));
  return next.toISOString();
}

function closestVideoDuration(value: unknown, model: string, fallback = 8) {
  const requested = Number(value || fallback);
  const options = model === "seedance-2.0" ? [5, 10, 15] : [8];
  return options.reduce((best, option) => Math.abs(option - requested) < Math.abs(best - requested) ? option : best, options[0]);
}

function isKieImageModel(model: string) {
  return model === "nanobanana-pro" || model === "gpt-image-2";
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

function normalizeIdeaText(value: string) {
  const stopWords = new Set(["the", "and", "or", "a", "an", "to", "for", "of", "in", "on", "with", "from", "by", "is", "are", "be", "this", "that", "it", "as", "at", "your", "you"]);
  return value.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9#]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word));
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

function sourceWatcherDuplicate(watcher: AutomationSourceWatcher, candidate: SourceWatcherCandidate, db: Database) {
  const threshold = watcher.duplicateProtection.similarityThreshold / 100;
  const cutoff = Date.now() - watcher.duplicateProtection.topicWindowDays * 24 * 60 * 60 * 1000;
  const text = [candidate.title, candidate.description, candidate.url].join("\n");
  const history = [
    ...(db.automationSourceRuns || []).filter((item) => item.workspaceId === watcher.workspaceId).map((item) => ({ id: item.id, title: item.selectedTitle || "", text: [item.selectedTitle, item.selectedUrl, item.selectionReason].join("\n"), url: item.selectedUrl || "", createdAt: item.completedAt || item.startedAt })),
    ...(db.publishQueue || []).filter((item) => item.workspaceId === watcher.workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt, item.caption].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt || item.scheduledAt })),
    ...(db.assets || []).filter((item) => item.workspaceId === watcher.workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt })),
    ...(db.competitorResults || []).filter((item) => item.workspaceId === watcher.workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.description].join("\n"), url: item.url, createdAt: item.capturedAt || item.publishedAt }))
  ].filter((item) => !item.createdAt || new Date(item.createdAt).getTime() >= cutoff);
  let best = { score: 0, title: "", id: "", reason: "No duplicate found." };
  for (const item of history) {
    const score = Math.max(sourceOverlapScore([candidate.url], item.url), ideaSimilarity(text, item.text));
    if (score > best.score) best = { score, title: item.title, id: item.id, reason: score >= 1 ? "Exact source URL was used before." : "Similar source/topic was used before." };
  }
  return { duplicate: best.score >= threshold, best, threshold };
}

function sourceWatcherReferences(watcher: AutomationSourceWatcher): GenerationAssetReference[] {
  const refs: GenerationAssetReference[] = [];
  if (watcher.referenceUrls.logo) refs.push({ role: "logo", fileName: "source-watcher-logo", url: watcher.referenceUrls.logo });
  if (watcher.referenceUrls.productPhoto) refs.push({ role: "product photo", fileName: "source-watcher-product-photo", url: watcher.referenceUrls.productPhoto });
  if (watcher.referenceUrls.avatar) refs.push({ role: "avatar/persona", fileName: "source-watcher-avatar", url: watcher.referenceUrls.avatar });
  if (watcher.referenceUrls.audio) refs.push({ role: "audio", fileName: "source-watcher-audio", url: watcher.referenceUrls.audio });
  return refs;
}

function enrichPromptWithAssetReferences(prompt: string, generationType: "video" | "image" | "text", refs: GenerationAssetReference[]) {
  if (generationType === "text" || refs.length === 0 || prompt.includes("Required uploaded reference usage")) return prompt;
  const mediaLabel = generationType === "image" ? "image" : "video";
  const refLabel = (ref: GenerationAssetReference) => `"${ref.fileName}"${ref.url ? ` at ${ref.url}` : ""}`;
  const lines = refs.map((ref) => {
    if (ref.role === "logo") return `- Logo reference ${refLabel(ref)}: include this exact brand logo clearly in the ${mediaLabel}. Do not replace it with generic text or an invented logo.`;
    if (ref.role === "product photo") return `- Product photo reference ${refLabel(ref)}: include the product/photo visibly as a main visual element.`;
    if (ref.role === "avatar/persona") return `- Avatar/persona reference ${refLabel(ref)}: use this as the on-screen person/creator/persona reference and keep it recognizable.`;
    if (ref.role === "audio" && generationType === "video") return `- Audio reference ${refLabel(ref)}: use this only as user-approved audio direction.`;
    return "";
  }).filter(Boolean);
  return `${prompt}\n\nRequired uploaded reference usage for this ${mediaLabel}:\n${lines.join("\n")}\nAll selected uploaded elements must appear in the final ${mediaLabel}. Add stroke, outline, drop shadow, backing shape, spacing, or contrast so uploaded elements are clearly distinguishable from the background.`;
}

function enhanceVideoPromptForProvider(input: { prompt: string; model: string; duration: number; aspectRatio: string; references: GenerationAssetReference[] }) {
  return [
    input.prompt,
    `Provider constraints: create one ${input.duration}s ${input.aspectRatio} video. Keep scene count tight and timed for the selected duration.`,
    input.model === "veo-fast" ? "VEO Fast supports short clips; do not request a longer 25-30 second structure." : "",
    input.references.length ? "Use the uploaded references exactly where relevant and do not copy original source logos, people, or audio." : ""
  ].filter(Boolean).join("\n\n");
}

function sourceWatcherPrompt(input: { watcher: AutomationSourceWatcher; candidate: SourceWatcherCandidate; generationType: "video" | "image" | "text"; personaContext: string }) {
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
    watcher.referenceUrls.logo ? `Use the uploaded logo/reference URL exactly as the brand logo: ${watcher.referenceUrls.logo}` : "No user logo is attached; do not copy any original source logo.",
    "Make the result suitable for the user's saved persona, brand context, and social media audience. Keep it original, high-conversion, mobile-first, and compliance-safe."
  ].filter(Boolean).join("\n"), personaContext);
}

function publishDescription(item: PublishItem, asset?: Asset) {
  return [item.caption, ...(item.hashtags || [])].filter(Boolean).join("\n\n") || asset?.prompt || item.prompt || item.title;
}

async function sendToUploadPost(item: PublishItem, asset?: Asset) {
  const description = publishDescription(item, asset);
  if (asset?.assetUrl && (item.generationType === "image" || asset.type === "image")) {
    return publishPhotoPost({ title: item.title, description, platform: item.platform, photoUrl: asset.assetUrl });
  }
  if (asset?.assetUrl) return publishVideoPost({ title: item.title, description, platform: item.platform, videoUrl: asset.assetUrl });
  return publishTextPost({ title: item.title, description, platform: item.platform });
}

async function log(workspaceId: string, entry: { action: string; label: string; status: "started" | "success" | "failed" | "info"; provider?: "apify" | "kie" | "upload-post" | "local" | "system"; prompt?: string; details?: Record<string, unknown>; error?: string }) {
  await mutateDb((db) => {
    db.debugLogs ||= [];
    db.debugLogs.push({ id: id("log"), workspaceId, createdAt: new Date().toISOString(), ...entry });
  });
}

async function autoPublishItem(workspaceId: string, item: PublishItem, asset?: Asset) {
  await log(workspaceId, { action: "automationRunDue", label: `Automation publishing to Upload-Post: ${item.title}`, status: "started", provider: "upload-post", prompt: publishDescription(item, asset), details: { publishId: item.id, platform: item.platform, generationType: item.generationType } });
  const upload = await sendToUploadPost(item, asset);
  await mutateDb((db) => {
    const current = db.publishQueue.find((queue) => queue.id === item.id && queue.workspaceId === workspaceId);
    if (!current) return;
    current.status = "published";
    current.provider = "upload-post";
    current.providerRequestId = upload.request_id || upload.job_id;
    current.error = "";
    db.activity.push({ id: id("act"), workspaceId, message: `Automation auto-published "${current.title}" through Upload-Post.`, createdAt: new Date().toISOString() });
  });
  await log(workspaceId, { action: "automationRunDue", label: `Automation Upload-Post accepted: ${item.title}`, status: "success", provider: "upload-post", details: { requestId: upload.request_id, jobId: upload.job_id } });
}

async function pollReadyGenerations(limit = 10) {
  const jobs = await mutateDb((db) => {
    return db.publishQueue
      .filter((item) => item.status === "generating" && item.workspaceId)
      .map((item) => {
        const asset = db.assets.find((asset) => asset.id === item.assetId && asset.workspaceId === item.workspaceId);
        const watcherId = String((item.generationSettings?.sourceWatcherId || asset?.generationSettings?.sourceWatcherId || "") as string);
        const watcher = watcherId ? (db.automationSourceWatchers || []).find((watcher) => watcher.id === watcherId && watcher.workspaceId === item.workspaceId) : undefined;
        return asset?.providerTaskId && watcher ? { item, asset, watcher } : null;
      })
      .filter((entry): entry is { item: PublishItem; asset: Asset; watcher: AutomationSourceWatcher } => Boolean(entry))
      .slice(0, limit);
  });
  const results = [];
  for (const job of jobs) {
    try {
      const model = job.asset.generationModel || job.item.generationModel || "";
      const isMarketTask = model === "seedance-2.0" || isKieImageModel(model) || job.asset.providerTaskId?.startsWith("task_");
      const done = isMarketTask
        ? { kind: "market" as const, status: await getMarketTask(job.asset.providerTaskId!) }
        : { kind: "veo" as const, status: await getVeoVideo(job.asset.providerTaskId!) };
      const success = done.kind === "market" ? done.status.state === "success" && done.status.assetUrl : done.status.successFlag === 1 && done.status.assetUrl;
      const failed = done.kind === "market" ? done.status.state === "fail" : done.status.successFlag === 2 || done.status.successFlag === 3;
      if (success) {
        const assetUrl = String(done.status.assetUrl);
        await mutateDb((db) => {
          const asset = db.assets.find((asset) => asset.id === job.asset.id && asset.workspaceId === job.item.workspaceId);
          const item = db.publishQueue.find((item) => item.id === job.item.id && item.workspaceId === job.item.workspaceId);
          if (asset) {
            asset.status = "ready";
            asset.progress = 100;
            asset.assetUrl = assetUrl;
            asset.error = "";
          }
          if (item) {
            item.status = "done";
            item.assetUrl = assetUrl;
            item.error = "";
          }
        });
        const current = { ...job.item, status: "done" as const, assetUrl };
        const asset = { ...job.asset, status: "ready" as const, progress: 100, assetUrl };
        if (job.watcher.approvalMode === "auto-publish") await autoPublishItem(job.item.workspaceId, current, asset);
        results.push({ id: job.item.id, status: "done" });
      } else if (failed) {
        const error = String(done.status.error || "Kie generation failed.");
        await mutateDb((db) => {
          const asset = db.assets.find((asset) => asset.id === job.asset.id && asset.workspaceId === job.item.workspaceId);
          const item = db.publishQueue.find((item) => item.id === job.item.id && item.workspaceId === job.item.workspaceId);
          if (asset) {
            asset.status = "failed";
            asset.error = error;
          }
          if (item) {
            item.status = "failed";
            item.error = error;
          }
        });
        results.push({ id: job.item.id, status: "failed", error });
      } else {
        results.push({ id: job.item.id, status: "rendering" });
      }
    } catch (error) {
      results.push({ id: job.item.id, status: "error", error: error instanceof Error ? error.message : "Poll failed" });
    }
  }
  return results;
}

async function runWatcher(watcher: AutomationSourceWatcher) {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const personaContext = await mutateDb((db) => {
    const persona = (db.personaProfiles || []).find((item) => item.workspaceId === watcher.workspaceId);
    return buildPersonaContext(persona);
  });
  const crawled = await Promise.all(watcher.sourceUrls.map(async (sourceUrl) => {
    try {
      const platform = platformFromUrl(sourceUrl);
      const rows = await scanSocialUrl(sourceUrl, watcher.minViews || 0);
      return rows.map((row, index): SourceWatcherCandidate => {
        const base = {
          id: id("swc"),
          platform,
          sourceUrl,
          url: row.sourceUrl || sourceUrl,
          title: row.title || `Source content ${index + 1}`,
          description: row.description || "",
          thumbnailUrl: row.thumbnailUrl,
          mediaUrl: row.mediaUrl,
          mediaType: row.mediaType || "unknown",
          views: Number(row.views || 0),
          likes: Number(row.likes || 0),
          comments: Number(row.comments || 0),
          publishedAt: row.publishedAt,
          duration: row.duration
        };
        return { ...base, score: sourceWatcherScore(base, watcher.rankingMode) };
      });
    } catch (error) {
      errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : "crawl failed"}`);
      return [];
    }
  }));
  const candidates = crawled.flat().sort((a, b) => b.score - a.score);
  const filtered = candidates.filter((item) => item.views >= watcher.minViews).filter((item) => watcher.contentType === "auto" || sourceWatcherKind(item, watcher.contentType) === watcher.contentType);

  const result = await mutateDb(async (db) => {
    db.automationSourceRuns ||= [];
    db.competitorResults ||= [];
    db.assets ||= [];
    db.publishQueue ||= [];
    db.debugLogs ||= [];
    const run: AutomationSourceRun = { id: id("srun"), workspaceId: watcher.workspaceId, watcherId: watcher.id, status: "running", sourceUrls: watcher.sourceUrls, scannedCount: candidates.length, startedAt };
    const storedResults: CompetitorResult[] = candidates.slice(0, 40).map((candidate) => ({
      id: candidate.id,
      workspaceId: watcher.workspaceId,
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
    const watcherRecord = db.automationSourceWatchers.find((item) => item.id === watcher.id && item.workspaceId === watcher.workspaceId);
    const selected = filtered.find((candidate) => !sourceWatcherDuplicate(watcher, candidate, db).duplicate);
    if (!selected) {
      run.status = "no-match";
      run.completedAt = new Date().toISOString();
      run.selectionReason = filtered.length ? "No suitable non-duplicate source found." : "No source results matched the watcher filters.";
      db.automationSourceRuns.push(run);
      if (watcherRecord) {
        watcherRecord.lastRunAt = run.completedAt;
        watcherRecord.nextRunAt = nextAutomationRunAt(watcherRecord.frequency, watcherRecord.postingTime);
        watcherRecord.updatedAt = run.completedAt;
      }
      return { run, selected: null, asset: null, publishItem: null };
    }
    const generationType = sourceWatcherKind(selected, watcher.contentType);
    const model = watcher.model || (generationType === "image" ? "gpt-image-2" : generationType === "text" ? "gemini-3.5-flash" : "veo-fast");
    const references = sourceWatcherReferences(watcher);
    const basePrompt = sourceWatcherPrompt({ watcher, candidate: selected, generationType, personaContext });
    const duration = generationType === "video" ? closestVideoDuration(watcher.duration || selected.duration || 8, model) : undefined;
    const prompt = generationType === "video"
      ? enhanceVideoPromptForProvider({ prompt: enrichPromptWithAssetReferences(basePrompt, generationType, references), model, duration: duration || 8, aspectRatio: watcher.aspectRatio, references })
      : enrichPromptWithAssetReferences(basePrompt, generationType, references);
    const isKieGeneration = generationType === "video" || (generationType === "image" && isKieImageModel(model));
    const now = new Date().toISOString();
    const generationSettings = { aspectRatio: watcher.aspectRatio, duration, sourceWatcherId: watcher.id };
    const asset: Asset = {
      id: id("ast"),
      workspaceId: watcher.workspaceId,
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
      assetUrl: generationType === "text" ? `data:text/plain;charset=utf-8,${encodeURIComponent(`${selected.description}\n\n#ContentAgent`)}` : undefined
    };
    db.assets.push(asset);
    const publishItem: PublishItem = {
      id: id("pub"),
      workspaceId: watcher.workspaceId,
      assetId: asset.id,
      title: asset.title,
      platform: selected.platform,
      scheduledAt: now,
      status: isKieGeneration ? "generating" : watcher.approvalMode === "auto-schedule" ? "scheduled" : "done",
      provider: isKieGeneration ? "kie" : "local",
      caption: selected.description || `Inspired by ${selected.platform}: ${selected.title}`,
      hashtags: ["#ContentAgent", `#${selected.platform.replace(/\s+/g, "")}`],
      generationModel: model,
      generationType,
      generationSettings,
      duration,
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
    run.selectionReason = `Selected by ${watcher.rankingMode} ranking from ${candidates.length} crawled results.`;
    run.publishItemId = publishItem.id;
    run.assetId = asset.id;
    db.automationSourceRuns.push(run);
    if (watcherRecord) {
      watcherRecord.lastRunAt = now;
      watcherRecord.nextRunAt = nextAutomationRunAt(watcherRecord.frequency, watcherRecord.postingTime);
      watcherRecord.updatedAt = now;
      watcherRecord.lastError = "";
    }
    return { run, selected, asset, publishItem };
  });

  await log(watcher.workspaceId, { action: "automationRunDue", label: `Source Watcher due run completed: ${watcher.name}`, status: "success", provider: "apify", prompt: result.publishItem?.prompt, details: { watcherId: watcher.id, scannedCount: candidates.length, selected: result.selected, errors } });

  if (!result.asset || !result.publishItem) return result;
  if (result.asset.provider === "kie") {
    try {
      const settings = result.asset.generationSettings || {};
      const model = result.asset.generationModel || watcher.model;
      const refs = result.asset.assetReferences || [];
      const taskId = isKieImageModel(model)
        ? await generateImage(result.asset.prompt || result.asset.title, { model, aspectRatio: String(settings.aspectRatio || watcher.aspectRatio), references: refs })
        : model === "seedance-2.0"
          ? await generateSeedanceVideo(result.asset.prompt || result.asset.title, { duration: Number(settings.duration || 8), aspectRatio: String(settings.aspectRatio || watcher.aspectRatio), references: refs })
          : await generateVeoVideo(result.asset.prompt || result.asset.title, { duration: Number(settings.duration || 8), aspectRatio: String(settings.aspectRatio || watcher.aspectRatio), references: refs });
      await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === result.asset?.id && item.workspaceId === watcher.workspaceId);
        const pub = db.publishQueue.find((item) => item.id === result.publishItem?.id && item.workspaceId === watcher.workspaceId);
        if (asset) {
          asset.providerTaskId = taskId;
          asset.status = "rendering";
          asset.progress = 35;
        }
        if (pub) pub.providerRequestId = taskId;
      });
      await log(watcher.workspaceId, { action: "automationRunDue", label: `Source Watcher Kie task started: ${taskId}`, status: "success", provider: "kie", prompt: result.asset.prompt, details: { model, taskId, watcherId: watcher.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kie generation failed";
      await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === result.asset?.id && item.workspaceId === watcher.workspaceId);
        const pub = db.publishQueue.find((item) => item.id === result.publishItem?.id && item.workspaceId === watcher.workspaceId);
        if (asset) {
          asset.status = "failed";
          asset.error = message;
        }
        if (pub) {
          pub.status = "failed";
          pub.error = message;
        }
      });
      await log(watcher.workspaceId, { action: "automationRunDue", label: "Source Watcher Kie generation failed", status: "failed", provider: "kie", error: message });
    }
  } else if (watcher.approvalMode === "auto-publish") {
    await autoPublishItem(watcher.workspaceId, result.publishItem, result.asset);
  }
  return result;
}

function platformFromUrl(url: string): Platform {
  const lower = url.toLowerCase();
  if (lower.includes("instagram.com")) return "Instagram";
  if (lower.includes("tiktok.com")) return "TikTok";
  if (lower.includes("facebook.com") || lower.includes("fb.watch")) return "Facebook";
  if (lower.includes("linkedin.com")) return "LinkedIn";
  if (lower.includes("x.com") || lower.includes("twitter.com")) return "X";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "YouTube";
  return allowedPlatforms[0];
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = Date.now();
  const polled = await pollReadyGenerations(12);
  const due = await mutateDb((db) => {
    return (db.automationSourceWatchers || [])
      .filter((watcher) => watcher.status === "active")
      .filter((watcher) => !watcher.nextRunAt || new Date(watcher.nextRunAt).getTime() <= now)
      .slice(0, 5);
  });
  const runs = [];
  for (const watcher of due) {
    try {
      runs.push(await runWatcher(watcher));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source Watcher due run failed";
      await mutateDb((db) => {
        const current = db.automationSourceWatchers.find((item) => item.id === watcher.id && item.workspaceId === watcher.workspaceId);
        if (current) {
          current.lastRunAt = new Date().toISOString();
          current.lastError = message;
          current.nextRunAt = nextAutomationRunAt(current.frequency, current.postingTime);
          current.updatedAt = new Date().toISOString();
        }
      });
      await log(watcher.workspaceId, { action: "automationRunDue", label: `Source Watcher due run failed: ${watcher.name}`, status: "failed", provider: "system", error: message });
      runs.push({ watcherId: watcher.id, error: message });
    }
  }
  return NextResponse.json({ ok: true, polled, dueWatchers: due.length, runs });
}
