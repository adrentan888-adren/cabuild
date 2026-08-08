import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";
import { generateSeedanceVideo, generateUgcStoryboardWithGpt55, getMarketTask } from "@/lib/providers/kie";
import { combineStoredVideos, encodeUploadKey, saveGeneratedMediaFromUrl } from "@/lib/providers/uploads";
import type { UgcVideoProject, UgcVideoScene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const STORYBOARD_COST_USD = Number(process.env.UGC_STORYBOARD_COST_USD || 0.03);
const VIDEO_SECOND_COST_USD = Number(process.env.UGC_VIDEO_SECOND_COST_USD || 0.06);
const ACTIVE_PROJECT_LIMIT = Number(process.env.UGC_ACTIVE_PROJECT_LIMIT || 2);

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const projects = (db.ugcVideoProjects || [])
    .filter((item) => item.workspaceId === user.workspaceId && item.ownerUserId === user.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action || "");
    if (action === "create") return createProject(user, body);
    if (action === "update") return updateProject(user, body);
    if (action === "storyboard") return createStoryboard(user, body);
    if (action === "generate") return startGeneration(user, body);
    if (action === "poll") return pollProject(request, user, body);
    if (action === "retry") return retryScene(user, body);
    if (action === "combine") return combineProject(request, user, body);
    if (action === "delete") return deleteProject(user, body);
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: sanitizedError(error) }, { status: 502 });
  }
}

async function createProject(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const productName = clean(body.productName, 120);
  const sourceImageUrl = clean(body.sourceImageUrl, 2000);
  const sourceImageStorageKey = clean(body.sourceImageStorageKey, 1000);
  if (!productName || !/^https?:\/\//i.test(sourceImageUrl) || !sourceImageStorageKey.startsWith(`uploads/${user.workspaceId}/`)) return NextResponse.json({ error: "Product name and a valid uploaded product image are required." }, { status: 400 });
  const now = new Date().toISOString();
  const project: UgcVideoProject = {
    id: id("ugc"), workspaceId: user.workspaceId, ownerUserId: user.id,
    productName, sellingPoints: clean(body.sellingPoints, 3000), audience: clean(body.audience, 1000),
    style: allowedStyle(body.style), language: allowedLanguage(body.language), targetDuration: allowedDuration(body.targetDuration),
    sourceImageUrl, sourceImageStorageKey,
    model: "seedance-2.0", aspectRatio: "9:16", resolution: "720p", status: "draft", scenes: [],
    estimatedStoryboardCostUsd: STORYBOARD_COST_USD, estimatedVideoCostUsd: 0, estimatedTotalCostUsd: STORYBOARD_COST_USD,
    costRateSnapshot: { storyboardUsd: STORYBOARD_COST_USD, videoSecondUsd: VIDEO_SECOND_COST_USD }, createdAt: now, updatedAt: now
  };
  await mutateDb((db) => { db.ugcVideoProjects ||= []; db.ugcVideoProjects.push(project); log(db, user.workspaceId, "ugcProjectCreated", project.id, "success"); });
  return NextResponse.json({ project });
}

async function updateProject(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const project = await mutateDb((db) => {
    const item = owned(db.ugcVideoProjects, user, body.projectId);
    if (["queued", "generating", "combining"].includes(item.status)) throw new Error("This project cannot be edited while generation is running.");
    if (body.productName !== undefined) item.productName = clean(body.productName, 120);
    if (body.sellingPoints !== undefined) item.sellingPoints = clean(body.sellingPoints, 3000);
    if (body.audience !== undefined) item.audience = clean(body.audience, 1000);
    if (body.style !== undefined) item.style = allowedStyle(body.style);
    if (body.language !== undefined) item.language = allowedLanguage(body.language);
    if (body.targetDuration !== undefined) item.targetDuration = allowedDuration(body.targetDuration);
    if (Array.isArray(body.scenes)) item.scenes = normalizeEditedScenes(body.scenes, item.targetDuration, item.scenes);
    item.updatedAt = new Date().toISOString();
    return item;
  });
  return NextResponse.json({ project });
}

async function createStoryboard(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const db = await readDb();
  const project = owned(db.ugcVideoProjects, user, body.projectId);
  const result = await generateUgcStoryboardWithGpt55({
    productName: project.productName, sellingPoints: project.sellingPoints, audience: project.audience,
    style: project.style, language: project.language, duration: project.targetDuration, template: db.promptTemplates.ugcStoryboard
  });
  const now = new Date().toISOString();
  const count = project.targetDuration <= 8 ? 2 : project.targetDuration <= 20 ? 4 : 6;
  const fallbackDuration = Math.max(4, Math.min(15, Math.round(project.targetDuration / count)));
  const scenes: UgcVideoScene[] = (result.scenes || []).slice(0, count).map((scene, index) => ({
    id: id("scene"), order: index + 1, title: clean(scene.title || `Scene ${index + 1}`, 100),
    prompt: clean(scene.prompt, 4000), dialogue: clean(scene.dialogue, 1000), duration: Math.max(4, Math.min(15, Number(scene.duration) || fallbackDuration)),
    status: "draft", progress: 0, retryCount: 0, estimatedCostUsd: 0, createdAt: now, updatedAt: now
  }));
  if (!scenes.length) throw new Error("GPT-5.5 did not return usable storyboard scenes.");
  const saved = await mutateDb((next) => {
    const item = owned(next.ugcVideoProjects, user, project.id);
    item.concept = clean(result.concept, 2000); item.caption = clean(result.caption, 3000); item.hashtags = Array.isArray(result.hashtags) ? result.hashtags.map((tag) => clean(tag, 80)).filter(Boolean).slice(0, 20) : [];
    item.scenes = scenes; item.estimatedVideoCostUsd = roundMoney(scenes.reduce((sum, scene) => sum + scene.duration * VIDEO_SECOND_COST_USD, 0));
    item.estimatedTotalCostUsd = roundMoney(item.estimatedStoryboardCostUsd + item.estimatedVideoCostUsd);
    item.scenes.forEach((scene) => { scene.estimatedCostUsd = roundMoney(scene.duration * VIDEO_SECOND_COST_USD); });
    item.status = "awaiting_confirmation"; item.updatedAt = now; log(next, user.workspaceId, "ugcStoryboardGenerated", item.id, "success"); return item;
  });
  return NextResponse.json({ project: saved });
}

async function startGeneration(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  if (body.confirmed !== true) return NextResponse.json({ error: "Explicit cost confirmation is required." }, { status: 400 });
  const db = await readDb();
  const project = owned(db.ugcVideoProjects, user, body.projectId);
  const active = db.ugcVideoProjects.filter((item) => item.ownerUserId === user.id && item.id !== project.id && ["queued", "generating", "combining"].includes(item.status)).length;
  if (active >= ACTIVE_PROJECT_LIMIT) return NextResponse.json({ error: `Only ${ACTIVE_PROJECT_LIMIT} UGC projects may generate at the same time.` }, { status: 429 });
  if (project.generationIdempotencyKey && project.scenes.some((scene) => scene.providerTaskId)) return NextResponse.json({ project });
  if (!project.scenes.length) return NextResponse.json({ error: "Create and review a storyboard first." }, { status: 400 });
  const key = clean(body.idempotencyKey, 128) || id("generation");
  await mutateDb((next) => { const item = owned(next.ugcVideoProjects, user, project.id); item.generationIdempotencyKey = key; item.status = "queued"; item.updatedAt = new Date().toISOString(); });
  for (const sourceScene of project.scenes) {
    const prompt = `${db.promptTemplates.ugcSceneGeneration}\n\nProduct: ${project.productName}. Complete storyboard concept: ${project.concept || project.style}. Scene ${sourceScene.order}: ${sourceScene.prompt}${sourceScene.dialogue ? ` Spoken dialogue in ${project.language}: ${sourceScene.dialogue}` : ""}`.slice(0, 6000);
    try {
      const taskId = await generateSeedanceVideo(prompt, { duration: sourceScene.duration, aspectRatio: "9:16", references: [{ role: "product photo", url: project.sourceImageUrl, fileName: "product-reference", contentType: "image/png" }] });
      await mutateDb((next) => { const item = owned(next.ugcVideoProjects, user, project.id); const scene = item.scenes.find((entry) => entry.id === sourceScene.id)!; scene.providerTaskId = taskId; scene.status = "waiting"; scene.updatedAt = new Date().toISOString(); item.status = "generating"; item.updatedAt = scene.updatedAt; });
    } catch (error) {
      await mutateDb((next) => { const item = owned(next.ugcVideoProjects, user, project.id); const scene = item.scenes.find((entry) => entry.id === sourceScene.id)!; scene.status = "failed"; scene.error = sanitizedError(error); scene.updatedAt = new Date().toISOString(); item.status = "partially_failed"; item.updatedAt = scene.updatedAt; });
    }
  }
  return NextResponse.json({ project: await getOwnedProject(user, project.id) });
}

async function pollProject(request: NextRequest, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const project = await getOwnedProject(user, body.projectId);
  for (const sourceScene of project.scenes.filter((scene) => scene.providerTaskId && !["completed", "failed", "cancelled"].includes(scene.status))) {
    try {
      const status = await getMarketTask(sourceScene.providerTaskId!);
      const providerState = String((status as { state?: string }).state || "");
      const assetUrl = String((status as { assetUrl?: string }).assetUrl || "");
      let stored: Awaited<ReturnType<typeof saveGeneratedMediaFromUrl>> | undefined;
      if (providerState === "success" && assetUrl) stored = await saveGeneratedMediaFromUrl({ workspaceId: user.workspaceId, assetId: `${project.id}-${sourceScene.id}`, sourceUrl: assetUrl, preferredContentType: "video/mp4" });
      await mutateDb((db) => {
        const item = owned(db.ugcVideoProjects, user, project.id); const scene = item.scenes.find((entry) => entry.id === sourceScene.id)!;
        scene.progress = Number((status as { progress?: number }).progress || (providerState === "success" ? 100 : 0)); scene.providerUrl = assetUrl || scene.providerUrl;
        scene.status = providerState === "success" ? "completed" : providerState === "fail" ? "failed" : providerState === "generating" ? "generating" : providerState === "queuing" ? "queued" : "waiting";
        scene.error = clean((status as { error?: string }).error, 500) || undefined;
        if (stored) { scene.storageKey = stored.key; scene.outputUrl = publicUploadUrl(request, stored.key); }
        scene.updatedAt = new Date().toISOString(); updateProjectStatus(item); item.updatedAt = scene.updatedAt;
      });
    } catch (error) {
      await mutateDb((db) => { const item = owned(db.ugcVideoProjects, user, project.id); const scene = item.scenes.find((entry) => entry.id === sourceScene.id)!; scene.error = sanitizedError(error); scene.updatedAt = new Date().toISOString(); });
    }
  }
  return NextResponse.json({ project: await getOwnedProject(user, project.id) });
}

async function retryScene(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const db = await readDb(); const project = owned(db.ugcVideoProjects, user, body.projectId); const scene = project.scenes.find((item) => item.id === String(body.sceneId));
  if (!scene || !["failed", "completed"].includes(scene.status)) return NextResponse.json({ error: "Only completed or failed scenes can be regenerated." }, { status: 400 });
  const prompt = `${db.promptTemplates.ugcSceneGeneration}\n\nProduct: ${project.productName}. Scene ${scene.order}: ${scene.prompt}${scene.dialogue ? ` Spoken dialogue in ${project.language}: ${scene.dialogue}` : ""}`.slice(0, 6000);
  const taskId = await generateSeedanceVideo(prompt, { duration: scene.duration, aspectRatio: "9:16", references: [{ role: "product photo", url: project.sourceImageUrl, fileName: "product-reference", contentType: "image/png" }] });
  const saved = await mutateDb((next) => { const item = owned(next.ugcVideoProjects, user, project.id); const target = item.scenes.find((entry) => entry.id === scene.id)!; target.providerTaskId = taskId; target.status = "waiting"; target.progress = 0; target.error = undefined; target.retryCount += 1; target.updatedAt = new Date().toISOString(); item.status = "generating"; item.finalVideoUrl = undefined; item.finalVideoStorageKey = undefined; item.updatedAt = target.updatedAt; return item; });
  return NextResponse.json({ project: saved });
}

async function combineProject(request: NextRequest, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const project = await getOwnedProject(user, body.projectId); const keys = project.scenes.sort((a, b) => a.order - b.order).map((scene) => scene.storageKey).filter((key): key is string => Boolean(key));
  if (keys.length !== project.scenes.length) return NextResponse.json({ error: "All scenes must complete before combining." }, { status: 400 });
  await mutateDb((db) => { const item = owned(db.ugcVideoProjects, user, project.id); item.status = "combining"; item.updatedAt = new Date().toISOString(); });
  const stored = await combineStoredVideos({ workspaceId: user.workspaceId, projectId: project.id, storageKeys: keys });
  const saved = await mutateDb((db) => { const item = owned(db.ugcVideoProjects, user, project.id); item.finalVideoStorageKey = stored.key; item.finalVideoUrl = publicUploadUrl(request, stored.key); item.status = "completed"; item.updatedAt = new Date().toISOString(); log(db, user.workspaceId, "ugcFinalVideoCombined", item.id, "success"); return item; });
  return NextResponse.json({ project: saved });
}

async function deleteProject(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  await mutateDb((db) => { const item = owned(db.ugcVideoProjects, user, body.projectId); if (["queued", "generating", "combining"].includes(item.status)) throw new Error("A running project cannot be deleted."); db.ugcVideoProjects = db.ugcVideoProjects.filter((entry) => entry.id !== item.id); });
  return NextResponse.json({ ok: true });
}

function owned(projects: UgcVideoProject[] | undefined, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, projectId: unknown) { const project = (projects || []).find((item) => item.id === String(projectId) && item.workspaceId === user.workspaceId && item.ownerUserId === user.id); if (!project) throw new Error("UGC project not found."); return project; }
async function getOwnedProject(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, projectId: unknown) { const db = await readDb(); return owned(db.ugcVideoProjects, user, projectId); }
function clean(value: unknown, max: number) { return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max); }
function allowedDuration(value: unknown) { const duration = Number(value); return duration === 8 || duration === 20 || duration === 30 ? duration : 20; }
function allowedLanguage(value: unknown) { const language = clean(value, 30); return ["Malay", "English", "Mandarin"].includes(language) ? language : "English"; }
function allowedStyle(value: unknown) { const style = clean(value, 80); const allowed = ["UGC product demo", "Problem-solution ad", "Cinematic product ad", "Talking-head review", "Unboxing", "Stop motion"]; return allowed.includes(style) ? style : allowed[0]; }
function normalizeEditedScenes(value: unknown[], duration: number, existing: UgcVideoScene[]) { const now = new Date().toISOString(); return value.slice(0, 8).map((raw, index) => { const item = raw as Record<string, unknown>; const old = existing.find((scene) => scene.id === String(item.id)); return { ...(old || { id: id("scene"), status: "draft" as const, progress: 0, retryCount: 0, estimatedCostUsd: 0, createdAt: now }), order: index + 1, title: clean(item.title, 100) || `Scene ${index + 1}`, prompt: clean(item.prompt, 4000), dialogue: clean(item.dialogue, 1000), duration: Math.max(4, Math.min(15, Number(item.duration) || Math.round(duration / Math.max(1, value.length)))), updatedAt: now }; }); }
function updateProjectStatus(project: UgcVideoProject) { if (project.scenes.every((scene) => scene.status === "completed")) project.status = "generating"; else if (project.scenes.some((scene) => scene.status === "failed")) project.status = "partially_failed"; else project.status = "generating"; }
function publicUploadUrl(request: NextRequest, key: string) { const origin = process.env.PUBLIC_BASE_URL || `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("x-forwarded-host") || new URL(request.url).host}`; return `${origin.replace(/\/+$/, "")}/api/public-uploads/${encodeUploadKey(key)}`; }
function roundMoney(value: number) { return Math.round(value * 10000) / 10000; }
function sanitizedError(error: unknown) { return (error instanceof Error ? error.message : "UGC video operation failed.").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500); }
function log(db: { debugLogs: Array<Record<string, unknown>> }, workspaceId: string, action: string, label: string, status: string) { db.debugLogs ||= []; db.debugLogs.push({ id: id("log"), workspaceId, action, label, status, provider: "kie", createdAt: new Date().toISOString() }); }
