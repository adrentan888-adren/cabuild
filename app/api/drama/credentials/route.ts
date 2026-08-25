import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProviderApiKey } from "@/lib/apiKeyOverrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!await currentUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const connected = Boolean(await getProviderApiKey("kie"));
  return NextResponse.json({
    configured: true,
    statuses: { kie: { connected, source: "CABUILD managed key store" } },
  });
}
