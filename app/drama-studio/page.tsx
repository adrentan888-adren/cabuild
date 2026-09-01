import { redirect } from "next/navigation";
import DramaStudio from "@/components/drama/drama-studio";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DramaStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const requestedStep = Number((await searchParams).step);
  const initialStep = [1, 2, 3, 4, 5].includes(requestedStep)
    ? requestedStep
    : 1;
  return <DramaStudio ownerId={user.id} initialStep={initialStep} />;
}
