import { createHmac, timingSafeEqual } from "node:crypto";
import type { DramaMediaTask } from "./media-tasks";
const purpose = "cabuild:drama-media-recovery:v1";
const lifetime = 7 * 24 * 60 * 60 * 1000;
const maxReceiptLength = 8192;
type Receipt = {
  purpose: string; workspaceId: string; taskId: string; issuedAt: number; expiresAt: number;
  assetId: string; publishItemId: string; kind: "image" | "video"; model: string;
  title: string; recordId: string; itemId: string; aspectRatio: string; duration?: number; createdAt: string;
};
export function requireMediaReceiptSecret() {
  const secret = process.env.APP_SECRET;
  // Recovery is ownership proof, so never use the public development-session default.
  if (!secret?.trim() || secret === "dev-secret-change-me") throw new Error("Media recovery signing is unavailable.");
  return secret;
}
function signature(payload: string) { return createHmac("sha256", requireMediaReceiptSecret()).update(`${purpose}.${payload}`).digest("base64url"); }
export function issueMediaTaskReceipt(task: DramaMediaTask) {
  const settings = task.asset.generationSettings;
  const issuedAt = Date.now();
  const receipt: Receipt = {
    purpose, workspaceId: task.workspaceId, taskId: task.taskId, issuedAt, expiresAt: issuedAt + lifetime,
    assetId: task.asset.id, publishItemId: task.publishItem.id, kind: task.asset.type === "video" ? "video" : "image",
    model: task.asset.generationModel || "", title: task.asset.title.slice(0, 120),
    recordId: String(settings?.dramaRecordId || "").slice(0, 200), itemId: String(settings?.dramaItemId || "").slice(0, 200),
    aspectRatio: String(settings?.aspectRatio || "16:9"), duration: task.publishItem.duration, createdAt: task.asset.createdAt,
  };
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  const token = `${payload}.${signature(payload)}`;
  if (token.length > maxReceiptLength) throw new Error("Media recovery information is too large.");
  return token;
}
export function recoverMediaTaskReceipt(token: string | null, workspaceId: string, taskId: string): DramaMediaTask | null {
  if (!token || token.length > maxReceiptLength || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const [payload, supplied] = token.split(".");
    const expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Receipt;
    const shortString = (item: unknown, max = 200) => typeof item === "string" && item.length <= max;
    if (value.purpose !== purpose || value.workspaceId !== workspaceId || value.taskId !== taskId ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || value.issuedAt > Date.now() + 60000 ||
      value.expiresAt <= Date.now() || value.expiresAt !== value.issuedAt + lifetime ||
      !shortString(value.workspaceId) || !shortString(value.taskId, 300) || !shortString(value.assetId) || !value.assetId ||
      !shortString(value.publishItemId) || !value.publishItemId || (value.kind !== "image" && value.kind !== "video") ||
      !shortString(value.model, 100) || !shortString(value.title, 120) || !shortString(value.recordId) || !shortString(value.itemId) ||
      !["16:9", "9:16", "1:1"].includes(value.aspectRatio) || !shortString(value.createdAt, 40) || !Number.isFinite(Date.parse(value.createdAt)) ||
      (value.duration !== undefined && (!Number.isFinite(value.duration) || value.duration < 3 || value.duration > 15))) return null;
    const generationSettings = { source: "drama-studio", dramaRecordId: value.recordId, dramaItemId: value.itemId, aspectRatio: value.aspectRatio, duration: value.duration };
    // Receipt intentionally excludes the full prompt/references to keep headers compact.
    // The client retains those inputs; recovery restores ownership and resulting media.
    return { workspaceId, taskId, asset: {
      id: value.assetId, workspaceId, briefId: value.recordId || "drama-studio", title: value.title, type: value.kind,
      status: "rendering", progress: 10, createdAt: value.createdAt, provider: "kie", providerTaskId: taskId,
      generationModel: value.model, generationSettings,
    }, publishItem: {
      id: value.publishItemId, workspaceId, assetId: value.assetId, title: value.title, platform: "TikTok",
      scheduledAt: value.createdAt, createdAt: value.createdAt, status: "generating", provider: "kie", providerRequestId: taskId,
      generationModel: value.model, generationType: value.kind, generationSettings, duration: value.duration,
    } };
  } catch { return null; }
}
