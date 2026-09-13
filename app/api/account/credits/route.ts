import { NextResponse } from "next/server";
import { apiKeyStatus, getProviderApiKey } from "@/lib/apiKeyOverrides";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApifyProvider = "apify" | "apifyBackup";

function readBalanceNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

async function readApifyBalance(provider: ApifyProvider, isConfigured: boolean) {
  if (!isConfigured) {
    return { credits: null, unit: null, message: "API key not configured" };
  }

  try {
    const apiKey = await getProviderApiKey(provider);
    const response = await fetch("https://api.apify.com/v2/users/me/limits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const payload = await response.json() as {
      data?: {
        limits?: { maxMonthlyUsageUsd?: unknown };
        current?: { monthlyUsageUsd?: unknown };
      };
    };
    const limit = readBalanceNumber(payload.data?.limits?.maxMonthlyUsageUsd);
    const used = readBalanceNumber(payload.data?.current?.monthlyUsageUsd);
    if (response.ok && limit !== null && used !== null) {
      return {
        credits: Math.max(0, Number((limit - used).toFixed(2))),
        unit: "USD",
        message: `$${used.toFixed(2)} of $${limit.toFixed(2)} used this cycle`,
      };
    }
  } catch {
    // Return a safe connection state when the provider balance is unavailable.
  }

  return { credits: null, unit: null, message: "Balance temporarily unavailable" };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [db, statuses] = await Promise.all([readDb(), apiKeyStatus()]);
  const workspace = db.workspaces.find((item) => item.id === user.workspaceId);
  const kieConfigured = statuses.kie.envConfigured || statuses.kie.overrideConfigured;
  let kieCredits: number | null = null;
  let kieMessage = kieConfigured ? "Balance temporarily unavailable" : "API key not configured";

  if (kieConfigured) {
    try {
      const apiKey = await getProviderApiKey("kie");
      const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      });
      const payload = await response.json() as { code?: number | string; data?: unknown };
      const credits = readBalanceNumber(payload.data);
      if (response.ok && Number(payload.code) === 200 && credits !== null) {
        kieCredits = credits;
        kieMessage = "Live provider balance";
      }
    } catch {
      // The header remains usable when a provider balance lookup is unavailable.
    }
  }

  const configured = (provider: keyof typeof statuses) =>
    statuses[provider].envConfigured || statuses[provider].overrideConfigured;
  const [apifyBalance, apifyBackupBalance] = await Promise.all([
    readApifyBalance("apify", configured("apify")),
    readApifyBalance("apifyBackup", configured("apifyBackup")),
  ]);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    workspace: {
      id: user.workspaceId,
      name: workspace?.name || "Content Agent",
      plan: workspace?.plan || "Starter",
      credits: workspace?.credits ?? 0,
    },
    providers: [
      { id: "kie", label: "KIE AI", configured: kieConfigured, credits: kieCredits, unit: "credits", message: kieMessage },
      { id: "apify", label: "Apify", configured: configured("apify"), ...apifyBalance },
      { id: "apifyBackup", label: "Apify backup", configured: configured("apifyBackup"), ...apifyBackupBalance },
      { id: "uploadPost", label: "Upload-Post", configured: configured("uploadPost"), credits: null, unit: null, message: "Provider does not expose a balance API" },
    ],
    checkedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
