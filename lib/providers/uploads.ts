import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const localUploadDir = path.join(process.cwd(), "data", "uploads");
const gcsBucket = process.env.UPLOADS_GCS_BUCKET || process.env.DATA_STORE_GCS_BUCKET;

export type StoredUpload = {
  key: string;
  contentType: string;
  size: number;
};

export function uploadKey(workspaceId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 90) || "upload";
  const nonce = crypto.randomBytes(10).toString("hex");
  return `uploads/${workspaceId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${nonce}-${safeName}`;
}

export function encodeUploadKey(key: string) {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeUploadKey(token: string) {
  return Buffer.from(token, "base64url").toString("utf8");
}

export async function saveUpload(key: string, buffer: Buffer, contentType: string): Promise<StoredUpload> {
  if (gcsBucket) {
    try {
      await writeGcsObject(key, buffer, contentType);
      return { key, contentType, size: buffer.length };
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "GCS upload failed; falling back to local upload storage.");
    }
  }
  const target = path.join(localUploadDir, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { key, contentType, size: buffer.length };
}

export async function readUpload(key: string) {
  if (!key.startsWith("uploads/")) throw new Error("Invalid upload key.");
  if (gcsBucket) {
    try {
      return await readGcsObject(key);
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "GCS upload read failed; falling back to local upload storage.");
    }
  }
  const target = path.join(localUploadDir, key);
  const buffer = await fs.readFile(target);
  return { buffer, contentType: contentTypeFromName(key) };
}

function contentTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

async function writeGcsObject(key: string, buffer: Buffer, contentType: string) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(gcsBucket!)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await googleAccessToken()}`,
      "Content-Type": contentType
    },
    body: new Uint8Array(buffer)
  });
  if (!res.ok) throw new Error(`Failed to upload reference asset to GCS: HTTP ${res.status} ${await res.text()}`);
}

async function readGcsObject(key: string) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(gcsBucket!)}/o/${encodeURIComponent(key)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await googleAccessToken()}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to read reference asset from GCS: HTTP ${res.status} ${await res.text()}`);
  const contentType = res.headers.get("content-type") || contentTypeFromName(key);
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

async function googleAccessToken() {
  const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
  const res = await fetch(metadataUrl, { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to get Google metadata token: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google metadata token response did not include an access token.");
  return json.access_token;
}
