import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { checkApifyHealth } from "@/lib/providers/apify";
import { checkKieHealth } from "@/lib/providers/kie";
import { checkUploadPostHealth } from "@/lib/providers/uploadPost";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [kie, apify, uploadPost] = await Promise.allSettled([
    checkKieHealth(),
    checkApifyHealth(),
    checkUploadPostHealth()
  ]);
  return NextResponse.json({
    kie: kie.status === "fulfilled" ? kie.value : { configured: false, error: kie.reason?.message },
    apify: apify.status === "fulfilled" ? apify.value : { configured: false, error: apify.reason?.message },
    uploadPost: uploadPost.status === "fulfilled" ? uploadPost.value : { configured: false, error: uploadPost.reason?.message }
  });
}
