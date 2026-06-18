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
  const scoped = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    workspace,
    brandKit: db.brandKits.find((item) => item.workspaceId === workspace.id),
    competitors: db.competitors.filter((item) => item.workspaceId === workspace.id),
    competitorResults: (db.competitorResults || []).filter((item) => item.workspaceId === workspace.id),
    researchScans: (db.researchScans || []).filter((item) => item.workspaceId === workspace.id).slice(-10).reverse(),
    socialAudits: (db.socialAudits || []).filter((item) => item.workspaceId === workspace.id).slice(-5).reverse(),
    connectedSocialAccounts,
    opportunities: db.opportunities.filter((item) => item.workspaceId === workspace.id),
    briefs: db.briefs.filter((item) => item.workspaceId === workspace.id),
    assets: db.assets.filter((item) => item.workspaceId === workspace.id),
    publishQueue: db.publishQueue.filter((item) => item.workspaceId === workspace.id),
    activity: db.activity.filter((item) => item.workspaceId === workspace.id).slice(-10).reverse()
  };
  return NextResponse.json(scoped);
}
