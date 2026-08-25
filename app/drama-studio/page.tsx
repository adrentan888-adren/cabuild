import { redirect } from "next/navigation";
import DramaStudio from "@/components/drama/drama-studio";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DramaStudioPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <DramaStudio ownerId={user.id} />;
}
