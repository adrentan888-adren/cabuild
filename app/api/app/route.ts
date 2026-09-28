import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";
import { getConnectedUploadPostAccounts } from "@/lib/providers/uploadPost";
import type { Brief } from "@/lib/types";

function contentKindFromFormat(format: string) {
  const lower = format.toLowerCase();
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok") || lower.includes("youtube")) return "video";
  if (lower.includes("image") || lower.includes("carousel")) return "image";
  return "text";
}

function normalizedResearchBrief(brief: Brief) {
  if (!brief.sourceResultId) return brief;
  const sourceKind = brief.sourceMediaType === "image"
    ? "image"
    : brief.sourceMediaType === "video"
      ? "video"
      : (brief.sourcePlatform === "LinkedIn" || brief.sourcePlatform === "X" ? "text" : "");
  if (!sourceKind || contentKindFromFormat(brief.format) === sourceKind) return brief;
  const format = sourceKind === "image" ? "Image 1:1" : sourceKind === "text" ? "Text post" : brief.sourcePlatform === "YouTube" ? "Long-form video 16:9" : "Short video 9:16";
  return { ...brief, format, duration: sourceKind === "video" ? brief.duration : undefined };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const connectedSocialAccounts = await getConnectedUploadPostAccounts().catch(() => []);
  const workspace = db.workspaces.find((item) => item.id === user.workspaceId)!;
  const workspaceAssets = db.assets.filter((item) => item.workspaceId === workspace.id);
  const scoped = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    workspace,
    brandKit: db.brandKits.find((item) => item.workspaceId === workspace.id),
    personaProfile: db.personaProfiles.find((item) => item.workspaceId === workspace.id),
    competitors: db.competitors.filter((item) => item.workspaceId === workspace.id),
    competitorResults: (db.competitorResults || []).filter((item) => item.workspaceId === workspace.id),
    researchScans: (db.researchScans || []).filter((item) => item.workspaceId === workspace.id).slice(-10).reverse(),
    socialAudits: (db.socialAudits || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    connectedSocialAccounts,
    opportunities: db.opportunities.filter((item) => item.workspaceId === workspace.id),
    briefs: db.briefs.filter((item) => item.workspaceId === workspace.id).map(normalizedResearchBrief),
    assets: workspaceAssets,
    publishQueue: db.publishQueue
      .filter((item) => item.workspaceId === workspace.id)
      .map((item) => {
        const asset = workspaceAssets.find((entry) => entry.id === item.assetId);
        const missingImage = item.status === "done" && item.generationType === "image" && !(item.assetUrl || asset?.assetUrl);
        return missingImage ? { ...item, status: "failed" as const, error: "Image generation was marked done before the image provider was connected. Regenerate this item." } : item;
      }),
    automationRules: (db.automationRules || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    automationJobs: (db.automationJobs || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50),
    automationSourceWatchers: (db.automationSourceWatchers || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    automationSourceRuns: (db.automationSourceRuns || []).filter((item) => item.workspaceId === workspace.id).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 50),
    activity: db.activity.filter((item) => item.workspaceId === workspace.id).slice(-10).reverse(),
    debugLogs: (db.debugLogs || []).filter((item) => item.workspaceId === workspace.id).slice(-200).reverse(),
    promptTemplates: db.promptTemplates
  };
  return NextResponse.json(scoped);
}
