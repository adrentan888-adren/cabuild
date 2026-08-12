import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { id, mutateDb, readDb } from "@/lib/store";
import { apiKeyStatus, saveApiKeyOverride } from "@/lib/apiKeyOverrides";
import type { ApiKeyProvider } from "@/lib/types";

const providers: ApiKeyProvider[] = [
  "kie", "apify", "apifyBackup", "youtube", "uploadPost",
  "stripePublishable", "stripeSecret", "stripeWebhook", "stripePortal",
  "stripeTestPublishable", "stripeTestSecret", "stripeTestWebhook", "stripeTestPortal",
  "stripeLivePublishable", "stripeLiveSecret", "stripeLiveWebhook", "stripeLivePortal"
];

async function requireAdmin(permission: "apiKeys.view" | "apiKeys.edit") {
  const user = await currentUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const db = await readDb();
  if (!hasPermission(db, user, permission)) return { error: "Forbidden", status: 403 as const };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin("apiKeys.view");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ providers: await apiKeyStatus() });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin("apiKeys.edit");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json() as Record<string, unknown>;
  const provider = String(body.provider || "") as ApiKeyProvider;
  const value = String(body.value || "").trim();
  if (!providers.includes(provider)) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  if (!value) return NextResponse.json({ error: "API key is required." }, { status: 400 });
  const saved = await saveApiKeyOverride(provider, value, auth.user.id);
  await mutateDb((db) => {
    db.activity.push({ id: id("act"), workspaceId: auth.user.workspaceId, message: `Admin updated ${provider} API key override.`, createdAt: new Date().toISOString() });
  });
  return NextResponse.json({ saved, providers: await apiKeyStatus() });
}
