import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type BriefJob = {
  id: string;
  stage?: 1 | 2;
  sourceId?: string;
  snapshot: Record<string, unknown>;
  model: string;
  status: "generating" | "ready" | "failed";
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

const bucket = process.env.DATA_STORE_GCS_BUCKET;
const namespace = createHash("sha256").update(process.env.DATA_STORE_GCS_OBJECT || "app.json").digest("hex").slice(0, 16);
const root = `drama-brief-jobs/${namespace}/`;
const localRoot = path.join(process.cwd(), "data", "drama-brief-jobs", namespace);
const timeoutMs = 5 * 60 * 1000;
export const validBriefJobId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

function ownerPrefix(ownerId: string) {
  return `${root}${createHash("sha256").update(ownerId).digest("hex")}/`;
}
function objectName(ownerId: string, id: string, part: "claim" | "result" | "deleted") {
  if (!validBriefJobId(id)) throw new Error("Invalid brief generation ID.");
  return `${ownerPrefix(ownerId)}${id.toLowerCase()}.${part}.json`;
}
function localPath(name: string) {
  return path.join(localRoot, ...name.slice(root.length).split("/"));
}
async function cloudHeaders() {
  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" }, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Brief storage authentication is temporarily unavailable.");
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Brief storage authentication is temporarily unavailable.");
  return { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
}
async function readObject<T>(name: string): Promise<T | null> {
  if (bucket) {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, {
      headers: await cloudHeaders(), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Saved brief information is temporarily unavailable. Please try again.");
    return await response.json() as T;
  }
  try { return JSON.parse(await fs.readFile(localPath(name), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

// Immutable objects make the initial claim and final transition atomic across Cloud Run instances.
// A deleted job keeps its claim, so replaying an old request can never spend again.
async function createObject(name: string, value: unknown): Promise<boolean> {
  if (bucket) {
    const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=0`, {
      method: "POST", headers: await cloudHeaders(), body: JSON.stringify(value), signal: AbortSignal.timeout(15000),
    });
    if (response.status === 412) return false;
    if (!response.ok) throw new Error("The brief could not be saved safely. Please try again when storage is available.");
    return true;
  }
  const destination = localPath(name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx" });
    try { await fs.link(temporary, destination); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
async function listObjects(ownerId: string): Promise<string[]> {
  const prefix = ownerPrefix(ownerId);
  if (bucket) {
    const names: string[] = [];
    let pageToken = "";
    do {
      const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("fields", "items(name),nextPageToken");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url, { headers: await cloudHeaders(), cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Saved briefs are temporarily unavailable. Please try again.");
      const page = await response.json() as { items?: Array<{ name: string }>; nextPageToken?: string };
      names.push(...(page.items || []).map(item => item.name));
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    return names;
  }
  try { return (await fs.readdir(localPath(prefix))).map(name => `${prefix}${name}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function getBriefJob(ownerId: string, id: string): Promise<BriefJob | null> {
  if (await readObject(objectName(ownerId, id, "deleted"))) return null;
  const result = await readObject<BriefJob>(objectName(ownerId, id, "result"));
  if (result) return result;
  const claim = await readObject<BriefJob>(objectName(ownerId, id, "claim"));
  if (claim && Date.now() - Date.parse(claim.createdAt) > timeoutMs) {
    const failed: BriefJob = { ...claim, status: "failed", finishedAt: new Date().toISOString(), error: `${claim.stage === 2 ? "Story Studio" : "Brief"} generation was interrupted or did not finish within 5 minutes. Your inputs have been saved. No automatic retry was made.` };
    await createObject(objectName(ownerId, id, "result"), failed);
    return await readObject<BriefJob>(objectName(ownerId, id, "result"));
  }
  return claim;
}
export async function listBriefJobs(ownerId: string): Promise<BriefJob[]> {
  const names = await listObjects(ownerId);
  const deleted = new Set(names.filter(name => name.endsWith(".deleted.json")).map(name => name.replace(/\.deleted\.json$/, "")));
  const ids = names.filter(name => name.endsWith(".claim.json") && !deleted.has(name.replace(/\.claim\.json$/, "")))
    .map(name => name.slice(name.lastIndexOf("/") + 1, -".claim.json".length));
  const jobs: BriefJob[] = [];
  for (let start = 0; start < ids.length; start += 8) {
    const batch = await Promise.all(ids.slice(start, start + 8).map(id => getBriefJob(ownerId, id)));
    jobs.push(...batch.filter((job): job is BriefJob => Boolean(job)));
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function claimBriefJob(ownerId: string, job: BriefJob) {
  const claimed = await createObject(objectName(ownerId, job.id, "claim"), job);
  return { claimed, job: claimed ? job : await getBriefJob(ownerId, job.id) };
}
export async function finishBriefJob(ownerId: string, job: BriefJob) {
  await createObject(objectName(ownerId, job.id, "result"), job);
  return getBriefJob(ownerId, job.id);
}
export async function deleteBriefJob(ownerId: string, id: string) {
  const job = await getBriefJob(ownerId, id);
  if (!job) return "missing";
  if (job.status === "generating") return "generating";
  await createObject(objectName(ownerId, id, "deleted"), { deletedAt: new Date().toISOString() });
  return "deleted";
}
