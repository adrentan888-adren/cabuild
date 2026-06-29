import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb } from "@/lib/store";
import { encodeUploadKey, saveUpload, uploadKey } from "@/lib/providers/uploads";

const maxUploadBytes = 20 * 1024 * 1024;
const allowedRoles = new Set(["product photo", "avatar/persona", "logo", "audio"]);

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const role = String(form.get("role") || "").trim();
  const file = form.get("file");

  if (!allowedRoles.has(role)) return NextResponse.json({ error: "Invalid upload role." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file." }, { status: 400 });
  const isAudio = role === "audio";
  if (isAudio && !file.type.startsWith("audio/")) return NextResponse.json({ error: "Audio reference must be an audio file." }, { status: 400 });
  if (!isAudio && !file.type.startsWith("image/")) return NextResponse.json({ error: "Visual references must be image files." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ error: "Upload must be 20MB or smaller." }, { status: 400 });

  const key = uploadKey(user.workspaceId, file.name);
  const stored = await saveUpload(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  const token = encodeUploadKey(stored.key);
  const origin = publicOrigin(req);
  const url = `${origin}/api/public-uploads/${token}`;

  await mutateDb((db) => {
    db.debugLogs ||= [];
    db.debugLogs.push({
      id: id("log"),
      workspaceId: user.workspaceId,
      action: "uploadReferenceAsset",
      label: `Uploaded ${role}: ${file.name}`,
      status: "success",
      provider: "system",
      details: { role, fileName: file.name, contentType: stored.contentType, size: stored.size, storageKey: stored.key, url },
      createdAt: new Date().toISOString()
    });
  });

  return NextResponse.json({
    role,
    fileName: file.name,
    contentType: stored.contentType,
    size: stored.size,
    storageKey: stored.key,
    url
  });
}

function publicOrigin(req: NextRequest) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}
