import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { spawn } from "child_process";

const localUploadDir = path.join(process.cwd(), "data", "uploads");
const gcsBucket = process.env.UPLOADS_GCS_BUCKET || process.env.DATA_STORE_GCS_BUCKET;
const maxGeneratedMediaBytes = 250 * 1024 * 1024;

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

export function generatedMediaKey(workspaceId: string, assetId: string, sourceUrl: string, contentType?: string) {
  const ext = extensionForGeneratedMedia(sourceUrl, contentType);
  const safeAssetId = assetId.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "asset";
  const nonce = crypto.randomBytes(8).toString("hex");
  return `generated/${workspaceId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${nonce}-${safeAssetId}.${ext}`;
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

export async function saveGeneratedMediaFromUrl(input: { workspaceId: string; assetId: string; sourceUrl: string; preferredContentType?: string }): Promise<StoredUpload> {
  const res = await fetch(input.sourceUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch generated media: HTTP ${res.status}`);
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > maxGeneratedMediaBytes) throw new Error(`Generated media is too large to store (${contentLength} bytes).`);
  const responseContentType = res.headers.get("content-type")?.split(";")[0].toLowerCase();
  const contentType = !responseContentType || responseContentType === "application/octet-stream"
    ? input.preferredContentType || contentTypeFromName(input.sourceUrl)
    : responseContentType;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxGeneratedMediaBytes) throw new Error(`Generated media is too large to store (${buffer.length} bytes).`);
  const key = generatedMediaKey(input.workspaceId, input.assetId, input.sourceUrl, contentType);
  return saveUpload(key, buffer, contentType);
}

export async function saveCaptionedGeneratedVideo(input: { workspaceId: string; assetId: string; sourceUrl: string; caption?: string; duration?: number }) {
  const media = await downloadGeneratedMedia(input.sourceUrl, "video/mp4");
  const rawKey = generatedMediaKey(input.workspaceId, `${input.assetId}-raw`, input.sourceUrl, media.contentType);
  const raw = await saveUpload(rawKey, media.buffer, media.contentType);
  const srtText = buildSrt(input.caption || "", input.duration || 8);
  const subtitleKey = generatedMediaKey(input.workspaceId, `${input.assetId}-captions`, "captions.srt", "application/x-subrip");
  const subtitles = await saveUpload(subtitleKey, Buffer.from(srtText, "utf8"), "application/x-subrip");
  if (!srtText.trim()) return { final: raw, raw, subtitles };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contentagent-caption-"));
  const inputPath = path.join(tempDir, "raw.mp4");
  const subtitlePath = path.join(tempDir, "captions.srt");
  const outputPath = path.join(tempDir, "final.mp4");
  try {
    await fs.writeFile(inputPath, media.buffer);
    await fs.writeFile(subtitlePath, srtText, "utf8");
    await runFfmpeg(inputPath, subtitlePath, outputPath);
    const finalBuffer = await fs.readFile(outputPath);
    const finalKey = generatedMediaKey(input.workspaceId, `${input.assetId}-captioned`, "final.mp4", "video/mp4");
    const final = await saveUpload(finalKey, finalBuffer, "video/mp4");
    return { final, raw, subtitles };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function downloadGeneratedMedia(sourceUrl: string, fallbackContentType: string) {
  const res = await fetch(sourceUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch generated media: HTTP ${res.status}`);
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > maxGeneratedMediaBytes) throw new Error(`Generated media is too large to store (${contentLength} bytes).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxGeneratedMediaBytes) throw new Error(`Generated media is too large to store (${buffer.length} bytes).`);
  const contentType = res.headers.get("content-type")?.split(";")[0].toLowerCase() || fallbackContentType;
  return { buffer, contentType: contentType === "application/octet-stream" ? fallbackContentType : contentType };
}

function buildSrt(caption: string, duration: number) {
  const clean = caption.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const words = clean.split(" ");
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 8) chunks.push(words.slice(index, index + 8).join(" "));
  const safeDuration = Math.max(1, Number(duration) || 8);
  const cueDuration = safeDuration / chunks.length;
  return chunks.map((text, index) => {
    const start = index * cueDuration;
    const end = Math.min(safeDuration, (index + 1) * cueDuration);
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`;
  }).join("\n");
}

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function runFfmpeg(inputPath: string, subtitlePath: string, outputPath: string) {
  const escapedSubtitlePath = subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const filter = `subtitles='${escapedSubtitlePath}':force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=42'`;
  return new Promise<void>((resolve, reject) => {
    const process = spawn("ffmpeg", ["-y", "-i", inputPath, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath]);
    let errorOutput = "";
    process.stderr.on("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-4000);
    });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg caption rendering failed (${code}): ${errorOutput.slice(-500)}`)));
  });
}

export async function readUpload(key: string) {
  if (!key.startsWith("uploads/") && !key.startsWith("generated/")) throw new Error("Invalid upload key.");
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
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".srt")) return "application/x-subrip";
  if (lower.endsWith(".txt")) return "text/plain";
  return "image/png";
}

function extensionForGeneratedMedia(sourceUrl: string, contentType?: string) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("video/mp4")) return "mp4";
  if (normalized.includes("video/webm")) return "webm";
  if (normalized.includes("video/quicktime")) return "mov";
  if (normalized.includes("image/jpeg")) return "jpg";
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("image/gif")) return "gif";
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("text/plain")) return "txt";
  if (normalized.includes("subrip")) return "srt";
  try {
    const ext = path.extname(new URL(sourceUrl).pathname).replace(/^\./, "").toLowerCase();
    if (/^(mp4|webm|mov|jpg|jpeg|png|webp|gif|txt|srt)$/.test(ext)) return ext === "jpeg" ? "jpg" : ext;
  } catch {
    // Fall through to a conservative default.
  }
  return normalized.startsWith("video/") ? "mp4" : normalized.startsWith("text/") ? "txt" : "png";
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
