import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";
import { generateSeedanceVideo, generateUgcStoryboardWithGpt55, getMarketTask } from "@/lib/providers/kie";
import { encodeUploadKey, saveGeneratedMediaFromUrl } from "@/lib/providers/uploads";
import type { Database, UgcVideoGenerationAttempt, UgcVideoProject, UgcVideoScene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const TOTAL_DURATION = 15;
const SCENE_COUNT = 3;
const STORYBOARD_COST_USD = Number(process.env.UGC_STORYBOARD_COST_USD || 0.03);
const VIDEO_SECOND_COST_USD = Number(process.env.UGC_VIDEO_SECOND_COST_USD || 0.06);
const ACTIVE_PROJECT_LIMIT = Number(process.env.UGC_ACTIVE_PROJECT_LIMIT || 2);
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const GENERATION_WINDOW_LIMIT = Number(process.env.UGC_GENERATION_HOURLY_LIMIT || 6);

type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  return NextResponse.json({ projects: ownedProjects(db, user).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    switch (String(body.action || "")) {
      case "create": return createProject(user, body);
      case "update": return updateProject(user, body);
      case "storyboard": return createStoryboard(user, body);
      case "generate": return startGeneration(user, body);
      case "poll": return pollProject(request, user, body);
      case "duplicateLegacy": return duplicateLegacyProject(user, body);
      case "delete": return deleteProject(user, body);
      default: return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }
  } catch (error) {
    const message = sanitizedError(error);
    const status = /not found/i.test(message) ? 404 : /required|exactly|invalid|cannot|must|legacy/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

async function createProject(user: User, body: Record<string, unknown>) {
  const productName = clean(body.productName, 120);
  const sourceImageUrl = clean(body.sourceImageUrl, 2000);
  const sourceImageStorageKey = clean(body.sourceImageStorageKey, 1000);
  if (!productName || !/^https?:\/\//i.test(sourceImageUrl) || !sourceImageStorageKey.startsWith(`uploads/${user.workspaceId}/`)) {
    return NextResponse.json({ error: "Product name and a valid uploaded product image are required." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const videoCost = roundMoney(TOTAL_DURATION * VIDEO_SECOND_COST_USD);
  const project: UgcVideoProject = {
    id: id("ugc"), workspaceId: user.workspaceId, ownerUserId: user.id, workflowVersion: "single_video_v2",
    productName, sellingPoints: clean(body.sellingPoints, 3000), audience: clean(body.audience, 1000),
    style: allowedStyle(body.style), language: allowedLanguage(body.language), targetDuration: TOTAL_DURATION,
    sourceImageUrl, sourceImageStorageKey, model: "seedance-2.0", aspectRatio: allowedAspectRatio(body.aspectRatio), resolution: "720p",
    status: "draft", scenes: [], estimatedStoryboardCostUsd: STORYBOARD_COST_USD, estimatedVideoCostUsd: videoCost,
    estimatedTotalCostUsd: roundMoney(STORYBOARD_COST_USD + videoCost), costRateSnapshot: { storyboardUsd: STORYBOARD_COST_USD, videoSecondUsd: VIDEO_SECOND_COST_USD },
    generationAttempt: 0, generationAttempts: [], createdAt: now, updatedAt: now
  };
  await mutateDb((db) => { db.ugcVideoProjects ||= []; db.ugcVideoProjects.push(project); log(db, user.workspaceId, "ugcProjectCreated", project.id, "success", { workflowVersion: project.workflowVersion, aspectRatio: project.aspectRatio }); });
  return NextResponse.json({ project });
}

async function updateProject(user: User, body: Record<string, unknown>) {
  const project = await mutateDb((db) => {
    const item = owned(db, user, body.projectId);
    assertCurrentWorkflow(item);
    if (["queued", "generating"].includes(item.status)) throw new Error("This project cannot be edited while generation is running.");
    if (body.productName !== undefined) item.productName = clean(body.productName, 120);
    if (body.sellingPoints !== undefined) item.sellingPoints = clean(body.sellingPoints, 3000);
    if (body.audience !== undefined) item.audience = clean(body.audience, 1000);
    if (body.style !== undefined) item.style = allowedStyle(body.style);
    if (body.language !== undefined) item.language = allowedLanguage(body.language);
    if (body.aspectRatio !== undefined) item.aspectRatio = allowedAspectRatio(body.aspectRatio);
    if (Array.isArray(body.scenes)) item.scenes = normalizeEditedScenes(body.scenes, item.scenes);
    if (item.scenes.length) {
      assertStoryboard(item.scenes);
      item.status = item.generationAttempts.length ? item.status : "awaiting_confirmation";
      item.combinedPrompt = buildTimelinePrompt(item, db.promptTemplates.ugcSceneGeneration);
    }
    item.updatedAt = new Date().toISOString();
    return item;
  });
  return NextResponse.json({ project });
}

async function createStoryboard(user: User, body: Record<string, unknown>) {
  const db = await readDb();
  const project = owned(db, user, body.projectId);
  assertCurrentWorkflow(project);
  if (["queued", "generating"].includes(project.status)) throw new Error("A storyboard cannot be replaced while generation is running.");
  const result = await generateUgcStoryboardWithGpt55({
    productName: project.productName, sellingPoints: project.sellingPoints, audience: project.audience,
    style: project.style, language: project.language, duration: TOTAL_DURATION, aspectRatio: project.aspectRatio,
    template: db.promptTemplates.ugcStoryboard
  });
  const scenes = normalizePlannedScenes(result.scenes || []);
  assertStoryboard(scenes);
  const saved = await mutateDb((next) => {
    const item = owned(next, user, project.id);
    item.concept = clean(result.concept, 2000);
    item.caption = clean(result.caption, 3000);
    item.hashtags = Array.isArray(result.hashtags) ? result.hashtags.map((tag) => clean(tag, 80)).filter(Boolean).slice(0, 20) : [];
    item.scenes = scenes;
    item.combinedPrompt = buildTimelinePrompt(item, next.promptTemplates.ugcSceneGeneration);
    item.status = "awaiting_confirmation";
    item.updatedAt = new Date().toISOString();
    log(next, user.workspaceId, "ugcStoryboardGenerated", item.id, "success", { sceneDurations: scenes.map((scene) => scene.duration), totalDuration: TOTAL_DURATION });
    return item;
  });
  return NextResponse.json({ project: saved });
}

async function startGeneration(user: User, body: Record<string, unknown>) {
  if (body.confirmed !== true) return NextResponse.json({ error: "Explicit provider-cost confirmation is required." }, { status: 400 });
  let db = await readDb();
  let project = owned(db, user, body.projectId);
  assertCurrentWorkflow(project);
  if (Array.isArray(body.scenes)) {
    await mutateDb((next) => {
      const item = owned(next, user, body.projectId);
      item.scenes = normalizeEditedScenes(body.scenes as unknown[], item.scenes);
      assertStoryboard(item.scenes);
      item.combinedPrompt = buildTimelinePrompt(item, next.promptTemplates.ugcSceneGeneration);
      item.updatedAt = new Date().toISOString();
    });
    db = await readDb();
    project = owned(db, user, body.projectId);
  }
  assertStoryboard(project.scenes);
  const active = ownedProjects(db, user).filter((item) => item.id !== project.id && ["queued", "generating"].includes(item.status)).length;
  if (active >= ACTIVE_PROJECT_LIMIT) return NextResponse.json({ error: `Only ${ACTIVE_PROJECT_LIMIT} UGC projects may generate at the same time.` }, { status: 429 });
  const recentAttempts = ownedProjects(db, user).flatMap((item) => item.generationAttempts || []).filter((attempt) => Date.now() - Date.parse(attempt.createdAt) < GENERATION_WINDOW_MS).length;
  if (recentAttempts >= GENERATION_WINDOW_LIMIT) return NextResponse.json({ error: `Hourly UGC generation limit reached (${GENERATION_WINDOW_LIMIT}). Try again later.` }, { status: 429 });
  const idempotencyKey = clean(body.idempotencyKey, 128);
  if (!idempotencyKey) return NextResponse.json({ error: "A generation idempotency key is required." }, { status: 400 });
  if (project.generationIdempotencyKey === idempotencyKey) return NextResponse.json({ project });
  if (["queued", "generating"].includes(project.status)) return NextResponse.json({ project });
  const prompt = buildTimelinePrompt(project, db.promptTemplates.ugcSceneGeneration);
  const attemptNumber = (project.generationAttempt || 0) + 1;
  await mutateDb((next) => {
    const item = owned(next, user, project.id);
    item.generationIdempotencyKey = idempotencyKey;
    item.combinedPrompt = prompt;
    item.providerStatus = "queued";
    item.providerProgress = 0;
    item.providerError = undefined;
    item.status = "queued";
    item.updatedAt = new Date().toISOString();
    log(next, user.workspaceId, "ugcGenerationQueued", item.id, "started", { attemptNumber, aspectRatio: item.aspectRatio, duration: TOTAL_DURATION, estimatedCostUsd: item.estimatedVideoCostUsd, prompt });
  });
  try {
    const taskId = await generateSeedanceVideo(prompt, {
      duration: TOTAL_DURATION, aspectRatio: project.aspectRatio,
      references: [{ role: "product photo", url: project.sourceImageUrl, fileName: "product-reference", contentType: "image/png" }]
    });
    const saved = await mutateDb((next) => {
      const item = owned(next, user, project.id);
      const now = new Date().toISOString();
      const attempt: UgcVideoGenerationAttempt = {
        id: id("ugc_attempt"), attemptNumber, promptSnapshot: prompt, aspectRatio: item.aspectRatio,
        taskId, status: "waiting", progress: 0, estimatedCostUsd: item.estimatedVideoCostUsd, createdAt: now
      };
      item.generationAttempt = attemptNumber;
      item.generationAttempts.push(attempt);
      item.providerTaskId = taskId;
      item.providerStatus = "waiting";
      item.status = "generating";
      item.updatedAt = now;
      log(next, user.workspaceId, "ugcGenerationStarted", item.id, "success", { attemptNumber, taskId, duration: TOTAL_DURATION, aspectRatio: item.aspectRatio });
      return item;
    });
    return NextResponse.json({ project: saved });
  } catch (error) {
    await mutateDb((next) => {
      const item = owned(next, user, project.id);
      item.status = "failed";
      item.providerStatus = "failed";
      item.providerError = sanitizedError(error);
      item.updatedAt = new Date().toISOString();
      log(next, user.workspaceId, "ugcGenerationStartFailed", item.id, "failed", { attemptNumber, error: item.providerError });
    });
    throw error;
  }
}

async function pollProject(request: NextRequest, user: User, body: Record<string, unknown>) {
  const project = await getOwnedProject(user, body.projectId);
  assertCurrentWorkflow(project);
  const attempt = latestAttempt(project);
  if (!attempt || ["completed", "failed", "cancelled"].includes(attempt.status)) return NextResponse.json({ project });
  try {
    const status = await getMarketTask(attempt.taskId);
    const state = mapProviderState(String(status.state || ""));
    const assetUrl = clean(status.assetUrl, 2000);
    let stored: Awaited<ReturnType<typeof saveGeneratedMediaFromUrl>> | undefined;
    if (state === "completed" && assetUrl && !attempt.outputStorageKey) {
      stored = await saveGeneratedMediaFromUrl({ workspaceId: user.workspaceId, assetId: `${project.id}-attempt-${attempt.attemptNumber}`, sourceUrl: assetUrl, preferredContentType: "video/mp4" });
    }
    const saved = await mutateDb((db) => {
      const item = owned(db, user, project.id);
      const current = item.generationAttempts.find((entry) => entry.id === attempt.id)!;
      current.status = state;
      current.progress = Math.max(0, Math.min(100, Number(status.progress || (state === "completed" ? 100 : 0))));
      current.providerResultUrl = assetUrl || current.providerResultUrl;
      current.error = clean(status.error, 500) || undefined;
      item.providerStatus = state;
      item.providerProgress = current.progress;
      item.providerResultUrl = current.providerResultUrl;
      item.providerError = current.error;
      item.status = state === "completed" ? "completed" : state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : "generating";
      if (stored) {
        current.outputStorageKey = stored.key;
        current.outputUrl = publicUploadUrl(request, stored.key);
        current.completedAt = new Date().toISOString();
        item.finalVideoStorageKey = stored.key;
        item.finalVideoUrl = current.outputUrl;
        log(db, user.workspaceId, "ugcGenerationCompleted", item.id, "success", { attemptNumber: current.attemptNumber, taskId: current.taskId, outputStorageKey: stored.key });
      }
      item.updatedAt = new Date().toISOString();
      return item;
    });
    return NextResponse.json({ project: saved });
  } catch (error) {
    await mutateDb((db) => {
      const item = owned(db, user, project.id);
      item.providerError = sanitizedError(error);
      item.updatedAt = new Date().toISOString();
      log(db, user.workspaceId, "ugcGenerationPollFailed", item.id, "failed", { taskId: attempt.taskId, error: item.providerError });
    });
    throw error;
  }
}

async function duplicateLegacyProject(user: User, body: Record<string, unknown>) {
  const db = await readDb();
  const source = owned(db, user, body.projectId);
  if (source.workflowVersion !== "legacy_scene_jobs") throw new Error("Only legacy scene-job projects need migration duplication.");
  const now = new Date().toISOString();
  const videoCost = roundMoney(TOTAL_DURATION * VIDEO_SECOND_COST_USD);
  const duplicate: UgcVideoProject = {
    id: id("ugc"), workspaceId: user.workspaceId, ownerUserId: user.id, workflowVersion: "single_video_v2",
    productName: `${source.productName} copy`, sellingPoints: source.sellingPoints, audience: source.audience,
    style: source.style, language: source.language, targetDuration: TOTAL_DURATION, sourceImageUrl: source.sourceImageUrl,
    sourceImageStorageKey: source.sourceImageStorageKey, model: "seedance-2.0", aspectRatio: allowedAspectRatio(source.aspectRatio), resolution: "720p",
    status: "draft", scenes: [], estimatedStoryboardCostUsd: STORYBOARD_COST_USD, estimatedVideoCostUsd: videoCost,
    estimatedTotalCostUsd: roundMoney(STORYBOARD_COST_USD + videoCost), costRateSnapshot: { storyboardUsd: STORYBOARD_COST_USD, videoSecondUsd: VIDEO_SECOND_COST_USD },
    generationAttempt: 0, generationAttempts: [], createdAt: now, updatedAt: now
  };
  await mutateDb((next) => { next.ugcVideoProjects.push(duplicate); log(next, user.workspaceId, "ugcLegacyProjectDuplicated", duplicate.id, "success", { sourceProjectId: source.id }); });
  return NextResponse.json({ project: duplicate });
}

async function deleteProject(user: User, body: Record<string, unknown>) {
  await mutateDb((db) => {
    const item = owned(db, user, body.projectId);
    if (["queued", "generating"].includes(item.status)) throw new Error("A running project cannot be deleted.");
    db.ugcVideoProjects = db.ugcVideoProjects.filter((entry) => entry.id !== item.id);
  });
  return NextResponse.json({ ok: true });
}

function buildTimelinePrompt(project: UgcVideoProject, template: string) {
  assertStoryboard(project.scenes);
  let elapsed = 0;
  const timeline = [...project.scenes].sort((a, b) => a.order - b.order).map((scene, index) => {
    const start = elapsed;
    elapsed = roundTime(elapsed + scene.duration);
    return `Scene ${index + 1}: ${formatTime(start)}-${formatTime(elapsed)} seconds (${formatTime(scene.duration)} seconds)\nTitle: ${scene.title}\nDirection: ${scene.prompt}${scene.dialogue ? `\nSpoken dialogue in ${project.language}: ${scene.dialogue}` : ""}`;
  }).join("\n\n");
  return `${template}\n\nCreate one complete ${TOTAL_DURATION}-second video in ${project.aspectRatio} aspect ratio at 720p.\nProduct: ${project.productName}\nStyle: ${project.style}\nAudience: ${project.audience || "the product's intended customer"}\nApproved product facts and restrictions: ${project.sellingPoints || "Use only defensible product benefits."}\nDialogue language: ${project.language}\nOverall concept: ${project.concept || "A continuous high-conversion UGC product story."}\n\nFollow this exact time-coded storyboard:\n\n${timeline}\n\nFollow every timing boundary and transition precisely. Use the attached product image as the sole visual source of truth. The result must be one continuous video, not separate clips.`.slice(0, 10000);
}

function normalizePlannedScenes(rawScenes: Array<{ title?: string; prompt?: string; dialogue?: string; duration?: number }>): UgcVideoScene[] {
  if (rawScenes.length !== SCENE_COUNT) throw new Error("GPT-5.5 must return exactly three storyboard scenes.");
  const selected = rawScenes;
  const sourceDurations = selected.map((scene) => Math.max(1, Number(scene.duration) || 5));
  const total = sourceDurations.reduce((sum, value) => sum + value, 0);
  const first = Math.max(1, roundHalf(sourceDurations[0] / total * TOTAL_DURATION));
  const second = Math.max(1, roundHalf(sourceDurations[1] / total * TOTAL_DURATION));
  const third = roundHalf(TOTAL_DURATION - first - second);
  const durations = third >= 1 ? [first, second, third] : [4, 5, 6];
  const now = new Date().toISOString();
  return selected.map((scene, index) => ({
    id: id("scene"), order: index + 1, title: clean(scene.title || `Scene ${index + 1}`, 100),
    prompt: clean(scene.prompt, 4000), dialogue: clean(scene.dialogue, 1000) || undefined,
    duration: durations[index], status: "draft", progress: 0, retryCount: 0, estimatedCostUsd: 0, createdAt: now, updatedAt: now
  }));
}

function normalizeEditedScenes(rawScenes: unknown[], existing: UgcVideoScene[]) {
  if (rawScenes.length !== SCENE_COUNT) throw new Error("The storyboard must contain exactly three scenes.");
  const now = new Date().toISOString();
  return rawScenes.map((raw, index) => {
    const source = raw as Record<string, unknown>;
    const old = existing.find((scene) => scene.id === String(source.id));
    return {
      id: old?.id || id("scene"), order: index + 1, title: clean(source.title, 100) || `Scene ${index + 1}`,
      prompt: clean(source.prompt, 4000), dialogue: clean(source.dialogue, 1000) || undefined,
      duration: roundHalf(Number(source.duration)), createdAt: old?.createdAt || now, updatedAt: now
    } satisfies UgcVideoScene;
  });
}

function assertStoryboard(scenes: UgcVideoScene[]) {
  if (scenes.length !== SCENE_COUNT) throw new Error("The storyboard must contain exactly three scenes.");
  if (scenes.some((scene) => !scene.title.trim() || !scene.prompt.trim())) throw new Error("Every scene requires a title and prompt.");
  if (scenes.some((scene) => !Number.isFinite(scene.duration) || scene.duration < 1 || scene.duration > 13 || Math.abs(scene.duration * 2 - Math.round(scene.duration * 2)) > 0.001)) {
    throw new Error("Each scene duration must be between 1 and 13 seconds in 0.5-second increments.");
  }
  const total = roundTime(scenes.reduce((sum, scene) => sum + scene.duration, 0));
  if (Math.abs(total - TOTAL_DURATION) > 0.001) throw new Error(`Scene durations must total exactly ${TOTAL_DURATION} seconds. Current total: ${formatTime(total)} seconds.`);
}

function assertCurrentWorkflow(project: UgcVideoProject) { if (project.workflowVersion !== "single_video_v2") throw new Error("This legacy project is read-only. Duplicate it to use the current 15-second workflow."); }
function ownedProjects(db: Database, user: User) { return (db.ugcVideoProjects || []).filter((item) => item.workspaceId === user.workspaceId && item.ownerUserId === user.id); }
function owned(db: Database, user: User, projectId: unknown) { const project = ownedProjects(db, user).find((item) => item.id === String(projectId)); if (!project) throw new Error("UGC project not found."); return project; }
async function getOwnedProject(user: User, projectId: unknown) { return owned(await readDb(), user, projectId); }
function latestAttempt(project: UgcVideoProject) { return [...(project.generationAttempts || [])].sort((a, b) => b.attemptNumber - a.attemptNumber)[0]; }
function clean(value: unknown, max: number) { return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max); }
function allowedLanguage(value: unknown) { const language = clean(value, 30); return ["Malay", "English", "Mandarin"].includes(language) ? language : "English"; }
function allowedStyle(value: unknown) { const style = clean(value, 80); const allowed = ["UGC product demo", "Problem-solution ad", "Cinematic product ad", "Talking-head review", "Unboxing", "Stop motion"]; return allowed.includes(style) ? style : allowed[0]; }
function allowedAspectRatio(value: unknown): "9:16" | "16:9" | "1:1" { const ratio = clean(value, 10); return ratio === "16:9" || ratio === "1:1" ? ratio : "9:16"; }
function mapProviderState(value: string): UgcVideoGenerationAttempt["status"] { if (value === "success") return "completed"; if (value === "fail") return "failed"; if (value === "generating") return "generating"; if (value === "queuing") return "queued"; return "waiting"; }
function publicUploadUrl(request: NextRequest, key: string) { const origin = process.env.PUBLIC_BASE_URL || `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("x-forwarded-host") || new URL(request.url).host}`; return `${origin.replace(/\/+$/, "")}/api/public-uploads/${encodeUploadKey(key)}`; }
function roundMoney(value: number) { return Math.round(value * 10000) / 10000; }
function roundHalf(value: number) { return Math.round(value * 2) / 2; }
function roundTime(value: number) { return Math.round(value * 10) / 10; }
function formatTime(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function sanitizedError(error: unknown) { return (error instanceof Error ? error.message : "UGC video operation failed.").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500); }
function log(db: Database, workspaceId: string, action: string, label: string, status: "started" | "success" | "failed" | "info", details?: Record<string, unknown>) { db.debugLogs ||= []; db.debugLogs.push({ id: id("log"), workspaceId, action, label, status, provider: "kie", details, createdAt: new Date().toISOString() }); }
