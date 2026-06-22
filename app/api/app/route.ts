import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";
import { getConnectedUploadPostAccounts } from "@/lib/providers/uploadPost";

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
    socialAudits: (db.socialAudits || []).filter((item) => item.workspaceId === workspace.id).slice(-5).reverse(),
    connectedSocialAccounts,
    opportunities: db.opportunities.filter((item) => item.workspaceId === workspace.id),
    briefs: db.briefs.filter((item) => item.workspaceId === workspace.id),
    assets: workspaceAssets,
    publishQueue: db.publishQueue
      .filter((item) => item.workspaceId === workspace.id)
      .map((item) => {
        const asset = workspaceAssets.find((entry) => entry.id === item.assetId);
        const missingImage = item.status === "done" && item.generationType === "image" && !(item.assetUrl || asset?.assetUrl);
        return missingImage ? { ...item, status: "failed" as const, error: "Image generation was marked done before the image provider was connected. Regenerate this item." } : item;
      }),
    activity: db.activity.filter((item) => item.workspaceId === workspace.id).slice(-10).reverse(),
    debugLogs: (db.debugLogs || []).filter((item) => item.workspaceId === workspace.id).slice(-200).reverse()
  };
  return NextResponse.json(scoped);
}
