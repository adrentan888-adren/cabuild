import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { claimBriefJob, deleteBriefJob, finishBriefJob, listBriefJobs, validBriefJobId, type BriefJob } from "@/lib/drama/brief-jobs";
import { readDramaResponse } from "@/lib/drama/read-response";
import { POST as generateStage } from "../generate/stage/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () => json({ ok: false, error: "brief_storage_unavailable", message: "Saved brief information is temporarily unavailable. Your inputs have been kept. Please try again when storage is available." }, 503);

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
    if (text.length > 150000) return json({ ok: false, message: "The creative brief inputs are too large. Please shorten them and try again." }, 413);
    let body: { id?: unknown; snapshot?: Record<string, unknown>; model?: unknown };
    try { body = JSON.parse(text); } catch { return json({ ok: false, message: "Request body must be valid JSON." }, 400); }
    if (!body || !validBriefJobId(body.id) || !body.snapshot || typeof body.snapshot !== "object" || Array.isArray(body.snapshot) || typeof body.snapshot.roughStory !== "string" || !body.snapshot.roughStory.trim()) {
      return json({ ok: false, message: "A valid generation ID and rough story are required." }, 400);
    }
    if (body.model !== "gemini-3-pro" && body.model !== "gemini-2.5-flash") return json({ ok: false, message: "Choose a supported writing model." }, 400);
    const pending: BriefJob = { id: body.id.toLowerCase(), snapshot: { ...body.snapshot, generatedBrief: "" }, model: body.model, status: "generating", createdAt: new Date().toISOString() };
    const claim = await claimBriefJob(user.id, pending);
    if (!claim.claimed) {
      if (!claim.job) return json({ ok: false, message: "This creative brief has been deleted. Start a new brief to generate again." }, 410);
      return json({ ok: true, job: claim.job }, claim.job.status === "generating" ? 202 : 200);
    }
    // Keep the request active while the provider runs; do not rely on background CPU after a 202 response.
    // The persisted claim prevents replays from spending twice, and GET recovers completion after navigation.
    let finished: BriefJob;
    try {
      const response = await generateStage(new Request(new URL("/api/drama/generate/stage", request.url), {
        method: "POST", headers: { cookie: request.headers.get("cookie") || "", "Content-Type": "application/json" },
        body: JSON.stringify({ targetStage: 1, model: pending.model, snapshot: pending.snapshot }),
      }));
      const payload = await readDramaResponse(response);
      const result = payload.result as { brief?: unknown } | undefined;
      if (!response.ok || !payload.ok || typeof result?.brief !== "string" || !result.brief.trim()) {
        throw new Error(typeof payload.message === "string" ? payload.message : "The writing provider did not return a finished creative brief. Your inputs have been saved.");
      }
      finished = { ...pending, snapshot: { ...pending.snapshot, generatedBrief: result.brief }, status: "ready", finishedAt: new Date().toISOString() };
    } catch (error) {
      finished = { ...pending, status: "failed", error: error instanceof Error ? error.message : "Brief generation failed. Your inputs have been saved.", finishedAt: new Date().toISOString() };
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
    if (!validBriefJobId(id)) return json({ ok: false, message: "A valid brief generation ID is required." }, 400);
    const result = await deleteBriefJob(user.id, id);
    if (result === "generating") return json({ ok: false, message: "This brief is still generating. Wait for it to finish before deleting it." }, 409);
    return json({ ok: true });
  } catch { return unavailable(); }
}

