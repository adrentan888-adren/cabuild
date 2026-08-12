import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { checkApifyHealth } from "@/lib/providers/apify";
import { checkYoutubeHealth } from "@/lib/providers/youtube";
import { checkKieHealth } from "@/lib/providers/kie";
import { checkUploadPostHealth } from "@/lib/providers/uploadPost";
import { apiKeyStatus } from "@/lib/apiKeyOverrides";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [kie, apify, youtube, uploadPost] = await Promise.allSettled([
    checkKieHealth(),
    checkApifyHealth(),
    checkYoutubeHealth(),
    checkUploadPostHealth()
  ]);
  return NextResponse.json({
    kie: kie.status === "fulfilled" ? kie.value : { configured: false, error: kie.reason?.message },
    apify: apify.status === "fulfilled" ? apify.value : { configured: false, error: apify.reason?.message },
    youtube: youtube.status === "fulfilled" ? youtube.value : { configured: false, error: youtube.reason?.message },
    uploadPost: uploadPost.status === "fulfilled" ? uploadPost.value : { configured: false, error: uploadPost.reason?.message },
    apiKeyOverrides: await apiKeyStatus()
  });
}
