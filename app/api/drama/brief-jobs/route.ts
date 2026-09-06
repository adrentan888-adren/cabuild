import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { claimBriefJob, deleteBriefJob, finishBriefJob, listBriefJobs, validBriefJobId, type BriefJob } from "@/lib/drama/brief-jobs";
import { readDramaResponse } from "@/lib/drama/read-response";
import { POST as generateStage } from "../generate/stage/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () => json({ ok: false, error: "brief_storage_unavailable", message: "Saved generation information is temporarily unavailable. Your inputs have been kept. Please try again when storage is available." }, 503);
const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Save a complete renderable snapshot, including for sparse direct API requests. Never inherit
// downstream output into a new job or overwrite the source brief when its text has been edited.
function inputSnapshot(source: Record<string, unknown>, stage: 1 | 2): Record<string, unknown> {
  const text = (key: string, fallback = "") => typeof source[key] === "string" ? source[key] : fallback;
  const number = (key: string, fallback: number) => typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] > 0 ? source[key] : fallback;
  return {
    title: text("title", "Untitled drama"), roughStory: text("roughStory"), seedPrompt: text("seedPrompt"),
    continuity: text("continuity", "Strict"), generatedBrief: stage === 2 ? text("generatedBrief") : "",
    episodes: number("episodes", 8), episodeLength: number("episodeLength", 1),
    style: text("style", "Cinematic mystery"), language: text("language", "English"), aspectRatio: text("aspectRatio", "16:9"),
    pacing: text("pacing", "Slow burn"), audience: text("audience", "Young adults"), rating: text("rating", "PG-13"),
    tone: Array.isArray(source.tone) ? source.tone.filter(nonempty) : [],
    completed: stage === 2 ? [1] : [], storyline: "", episodePlan: [], characters: [], assets: [], scenes: [],
    autoFallback: typeof source.autoFallback === "boolean" ? source.autoFallback : true, assembled: false, episodeDrafts: 0,
  };
}

function storyResult(result: Record<string, unknown>) {
  const { storyline, episodes, characters, assets } = result;
  if (!nonempty(storyline) || !Array.isArray(episodes) || !episodes.length ||
      !episodes.every(episode => object(episode) && Number.isInteger(episode.number) && Number(episode.number) > 0 && nonempty(episode.title) && nonempty(episode.summary)) ||
      !Array.isArray(characters) || !characters.length || !characters.every(character => object(character) && ["name", "role", "appearance", "personality", "arc"].every(key => nonempty(character[key]))) ||
      !Array.isArray(assets) || !assets.length || !assets.every(asset => object(asset) && nonempty(asset.name) && ["Character", "Venue", "Object"].includes(String(asset.type)) && nonempty(asset.detail) && nonempty(asset.visualPrompt))) {
    throw new Error("The writing provider returned an incomplete Story Studio. A storyline, episode outlines, character profiles, and planned assets are required. Your inputs have been saved.");
  }
  return {
    storyline,
    episodePlan: episodes.map(episode => ({ number: episode.number, title: episode.title, summary: episode.summary })),
    characters: characters.map(character => ({ name: character.name, role: character.role, appearance: character.appearance, personality: character.personality, arc: character.arc })),
    assets: assets.map((asset, index) => ({
      id: `${asset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${index + 1}`,
      name: asset.name, type: asset.type, detail: asset.detail,
      visualPrompt: asset.visualPrompt
        .replace(/\b(?:aspect ratio|frame|format)\s*:?\s*\d+\s*[:/]\s*\d+\b/gi, "")
        .replace(/\b(?:portrait|vertical|landscape)\s+\d+\s*[:/]\s*\d+\b/gi, "")
        .replace(/\b\d+\s*[:/]\s*\d+\s+(?:aspect ratio|frame|format)\b/gi, "")
        .replace(/\s{2,}/g, " ").trim(),
      crop: `${18 + ((index * 17) % 74)}% center`, selected: true, status: "planned",
    })),
    scenes: [], episodeDrafts: episodes.length, completed: [1, 2],
  };
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: true, jobs: await listBriefJobs(user.id) });
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return json({ ok: false, error: "Unauthorized" }, 401);
    const text = await request.text();
    if (text.length > 150000) return json({ ok: false, message: "The generation inputs are too large. Please shorten them and try again." }, 413);
    let body: { id?: unknown; stage?: unknown; sourceId?: unknown; snapshot?: Record<string, unknown>; model?: unknown };
    try { body = JSON.parse(text); } catch { return json({ ok: false, message: "Request body must be valid JSON." }, 400); }
    if (!body || !validBriefJobId(body.id) || !object(body.snapshot)) return json({ ok: false, message: "A valid generation ID and input snapshot are required." }, 400);
    const stage = body.stage === undefined ? 1 : body.stage;
    if (stage !== 1 && stage !== 2) return json({ ok: false, message: "Choose Creative Brief or Story Studio generation." }, 400);
    if (stage === 1 && !nonempty(body.snapshot.roughStory)) return json({ ok: false, message: "A rough story is required." }, 400);
    if (stage === 2 && !nonempty(body.snapshot.generatedBrief)) return json({ ok: false, message: "A finished creative brief is required for Story Studio." }, 400);
    if (body.sourceId !== undefined && (!nonempty(body.sourceId) || body.sourceId.length > 200)) return json({ ok: false, message: "Choose a valid saved creative brief." }, 400);
    if (body.model !== "gemini-3-pro" && body.model !== "gemini-2.5-flash") return json({ ok: false, message: "Choose a supported writing model." }, 400);
    const pending: BriefJob = { id: body.id.toLowerCase(), stage, ...(typeof body.sourceId === "string" ? { sourceId: body.sourceId } : {}), snapshot: inputSnapshot(body.snapshot, stage), model: body.model, status: "generating", createdAt: new Date().toISOString() };
    const claim = await claimBriefJob(user.id, pending);
    if (!claim.claimed) {
      if (!claim.job) return json({ ok: false, message: "This generation has been deleted. Start a new generation to try again." }, 410);
      return json({ ok: true, job: claim.job }, claim.job.status === "generating" ? 202 : 200);
    }
    // Keep the request active while the provider runs; do not rely on background CPU after a 202 response.
    // The persisted claim prevents replays from spending twice, and GET recovers completion after navigation.
    let finished: BriefJob;
    try {
      const response = await generateStage(new Request(new URL("/api/drama/generate/stage", request.url), {
        method: "POST", headers: { cookie: request.headers.get("cookie") || "", "Content-Type": "application/json" },
        body: JSON.stringify({ targetStage: stage, model: pending.model, snapshot: pending.snapshot }),
      }));
      const payload = await readDramaResponse(response);
      const result = payload.result;
      if (!response.ok || !payload.ok || !object(result)) throw new Error(typeof payload.message === "string" ? payload.message : `The writing provider did not return a finished ${stage === 2 ? "Story Studio" : "creative brief"}. Your inputs have been saved.`);
      let output: Record<string, unknown>;
      if (stage === 2) output = storyResult(result);
      else {
        if (!nonempty(result.brief)) throw new Error("The writing provider did not return a finished creative brief. Your inputs have been saved.");
        output = { generatedBrief: result.brief, completed: [1] };
      }
      finished = { ...pending, snapshot: { ...pending.snapshot, ...output }, status: "ready", finishedAt: new Date().toISOString() };
    } catch (error) {
      finished = { ...pending, status: "failed", error: error instanceof Error ? error.message : `${stage === 2 ? "Story Studio" : "Brief"} generation failed. Your inputs have been saved.`, finishedAt: new Date().toISOString() };
    }
    const job = await finishBriefJob(user.id, finished);
    return json({ ok: true, job });
  } catch { return unavailable(); }
}

export async function DELETE(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return json({ ok: false, error: "Unauthorized" }, 401);
    const id = new URL(request.url).searchParams.get("id");
    if (!validBriefJobId(id)) return json({ ok: false, message: "A valid generation ID is required." }, 400);
    const result = await deleteBriefJob(user.id, id);
    if (result === "generating") return json({ ok: false, message: "This work is still generating. Wait for it to finish before deleting it." }, 409);
    return json({ ok: true });
  } catch { return unavailable(); }
}
