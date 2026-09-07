import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Asset, PublishItem } from "@/lib/types";

export type DramaMediaTask = { taskId: string; workspaceId: string; asset: Asset; publishItem: PublishItem };
export type DramaMediaResult = { state: "success" | "fail"; progress: number; resultUrls: string[]; message: string; failCode: string; model: string };
const bucket = process.env.DATA_STORE_GCS_BUCKET;
const namespace = createHash("sha256").update(process.env.DATA_STORE_GCS_OBJECT || "app.json").digest("hex").slice(0, 16);
const root = `drama-media-tasks/${namespace}/`;
function objectName(workspaceId: string, taskId: string, part: "task" | "result") {
  const owner = createHash("sha256").update(workspaceId).digest("hex");
  const task = createHash("sha256").update(taskId).digest("hex");
  return `${root}${owner}/${task}.${part}.json`;
}
function localPath(name: string) { return path.join(process.cwd(), "data", ...name.split("/")); }
async function headers() {
  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" }, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Media task storage authentication is temporarily unavailable.");
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Media task storage authentication is temporarily unavailable.");
  return { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
}
async function read<T>(name: string): Promise<T | null> {
  if (bucket) {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, {
      headers: await headers(), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Saved media task information is temporarily unavailable.");
    return await response.json() as T;
  }
  try { return JSON.parse(await fs.readFile(localPath(name), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
// One immutable object per owner/task prevents app.json lost updates from erasing
// ownership. The separate immutable terminal result also prevents late pending
// responses from reverting a completed task. Storage failure never falls back locally.
async function create(name: string, value: unknown) {
  if (bucket) {
    const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=0`, {
      method: "POST", headers: await headers(), body: JSON.stringify(value), signal: AbortSignal.timeout(15000),
    });
    if (response.status === 412) return;
    if (!response.ok) throw new Error("The media task could not be saved safely.");
    return;
  }
  const destination = localPath(name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx" });
    try { await fs.link(temporary, destination); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
export async function getDramaMediaTask(workspaceId: string, taskId: string) {
  const task = await read<DramaMediaTask>(objectName(workspaceId, taskId, "task"));
  if (task && (task.workspaceId !== workspaceId || task.taskId !== taskId || task.asset.workspaceId !== workspaceId || task.publishItem.workspaceId !== workspaceId)) {
    throw new Error("Saved media ownership could not be verified.");
  }
  return task;
}
export async function saveDramaMediaTask(task: DramaMediaTask) {
  await create(objectName(task.workspaceId, task.taskId, "task"), task);
  return (await getDramaMediaTask(task.workspaceId, task.taskId))!;
}
export async function getDramaMediaResult(workspaceId: string, taskId: string) {
  return read<DramaMediaResult>(objectName(workspaceId, taskId, "result"));
}
export async function finishDramaMediaTask(workspaceId: string, taskId: string, result: DramaMediaResult) {
  await create(objectName(workspaceId, taskId, "result"), result);
  return (await getDramaMediaResult(workspaceId, taskId))!;
}
