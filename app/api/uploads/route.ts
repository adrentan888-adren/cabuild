import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { encodeUploadKey, saveUpload, uploadKey } from "@/lib/providers/uploads";

const maxUploadBytes = 10 * 1024 * 1024;
const allowedRoles = new Set(["product photo", "avatar/persona", "logo"]);

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const role = String(form.get("role") || "").trim();
  const file = form.get("file");

  if (!allowedRoles.has(role)) return NextResponse.json({ error: "Invalid upload role." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image uploads are supported." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ error: "Upload must be 10MB or smaller." }, { status: 400 });

  const key = uploadKey(user.workspaceId, file.name);
  const stored = await saveUpload(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  const token = encodeUploadKey(stored.key);
  const origin = new URL(req.url).origin;

  return NextResponse.json({
    role,
    fileName: file.name,
    contentType: stored.contentType,
    size: stored.size,
    storageKey: stored.key,
    url: `${origin}/api/public-uploads/${token}`
  });
}
