import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProviderApiKey } from "@/lib/apiKeyOverrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!await currentUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = await getProviderApiKey("kie");
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_credential", message: "The CABUILD KIE AI key is not configured." },
      { status: 401 },
    );
  }
  try {
    const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const payload = await response.json() as { code?: number | string; msg?: string; data?: number };
    const credits = Number(payload.data);
    if (!response.ok || Number(payload.code) !== 200 || !Number.isFinite(credits)) {
      return NextResponse.json(
        { error: "credit_lookup_failed", message: response.status === 401 || response.status === 403 ? "Kie AI rejected the CABUILD key." : payload.msg || "Kie AI credits are temporarily unavailable." },
        { status: response.status === 401 || response.status === 403 ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { ok: true, credits, checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "credit_lookup_failed", message: "Kie AI credits are temporarily unavailable." },
      { status: 502 },
    );
  }
}
