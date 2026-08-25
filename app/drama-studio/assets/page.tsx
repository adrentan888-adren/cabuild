import { redirect } from "next/navigation";
import WorkspacePage from "@/components/drama/workspace-page";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DramaAssetLibraryPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <WorkspacePage page="assets" ownerId={user.id} />;
}
