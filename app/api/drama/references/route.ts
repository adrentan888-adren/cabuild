import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb } from "@/lib/store";
import { encodeUploadKey, saveUpload, uploadKey } from "@/lib/providers/uploads";
import type { PersonaMediaAsset } from "@/lib/types";

const maxUploadBytes = 20 * 1024 * 1024;
const allowedRoles = new Set<PersonaMediaAsset["role"]>([
  "product photo",
  "avatar/persona",
  "logo",
  "audio",
]);

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Upload must use multipart form data." },
      { status: 400 },
    );
  }
  const role = String(form.get("role") || "").trim() as PersonaMediaAsset["role"];
  const file = form.get("file");
  if (!allowedRoles.has(role)) {
    return NextResponse.json({ error: "Invalid upload role." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  const isAudio = role === "audio";
  if (isAudio ? !file.type.startsWith("audio/") : !file.type.startsWith("image/")) {
    return NextResponse.json(
      {
        error: isAudio
          ? "Audio reference must be an audio file."
          : "Visual references must be an image file.",
      },
      { status: 400 },
    );
  }
  if (file.size > maxUploadBytes) {
    return NextResponse.json(
      { error: "Upload must be 20MB or smaller." },
      { status: 400 },
    );
  }

  const key = uploadKey(user.workspaceId, file.name);
  const stored = await saveUpload(
    key,
    Buffer.from(await file.arrayBuffer()),
    file.type || "application/octet-stream",
  );
  const origin = publicOrigin(request);
  const url = origin + "/api/public-uploads/" + encodeUploadKey(stored.key);
  const asset: PersonaMediaAsset = {
    id: id("pma"),
    role,
    label: (file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name).slice(0, 80) || role,
    fileName: file.name,
    url,
    storageKey: stored.key,
    contentType: stored.contentType,
    createdAt: new Date().toISOString(),
  };

  const saved = await mutateDb((db) => {
    const persona = db.personaProfiles.find(
      (item) => item.workspaceId === user.workspaceId,
    );
    if (!persona) return false;
    persona.mediaAssets ||= [];
    if (role !== "product photo") {
      persona.mediaAssets = persona.mediaAssets.filter(
        (item) => item.role !== role,
      );
    }
    persona.mediaAssets.push(asset);
    persona.updatedAt = new Date().toISOString();
    db.activity.push({
      id: id("act"),
      workspaceId: user.workspaceId,
      message: 'Saved Drama reference asset "' + asset.label + '".',
      createdAt: new Date().toISOString(),
    });
    return true;
  });
  if (!saved) {
    return NextResponse.json(
      { error: "Persona profile was not found." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, asset });
}

function publicOrigin(request: NextRequest) {
  if (process.env.PUBLIC_BASE_URL) {
    const configuredOrigin = process.env.PUBLIC_BASE_URL;
    return configuredOrigin.endsWith("/")
      ? configuredOrigin.slice(0, -1)
      : configuredOrigin;
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return forwardedProto + "://" + forwardedHost;
  return new URL(request.url).origin;
}