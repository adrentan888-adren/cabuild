import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { generateContentPlanWithGpt55, generateSeedanceVideo, getMarketTask } from "@/lib/providers/kie";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!await currentUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "plan") {
      const productName = String(body.productName || "").trim();
      if (!productName) return NextResponse.json({ error: "Product name is required." }, { status: 400 });
      const duration = Math.max(8, Math.min(30, Number(body.duration) || 20));
      const plan = await generateContentPlanWithGpt55({
        idea: `Create a ${duration}-second ${String(body.style || "UGC product demo")} video for ${productName}.
Target audience: ${String(body.audience || "the product's ideal customer")}.
Selling points and restrictions: ${String(body.sellingPoints || "Show the product clearly using compliance-safe claims")}.
Dialogue language: ${String(body.language || "Malay")}.
Create a strong hook, believable demonstration, consistent product presentation, and compliance-safe CTA.`,
        niche: "Product advertising",
        requestedFormat: "Short video 9:16",
        requestedDuration: duration,
        requestedModel: "seedance-2.0"
      });
      return NextResponse.json({ plan });
    }

    if (action === "start") {
      const prompt = String(body.prompt || "").trim();
      const referenceUrl = String(body.referenceUrl || "").trim();
      if (prompt.length < 20) return NextResponse.json({ error: "A detailed scene prompt is required." }, { status: 400 });
      if (!/^https?:\/\//i.test(referenceUrl)) return NextResponse.json({ error: "A public product reference URL is required." }, { status: 400 });
      const taskId = await generateSeedanceVideo(prompt, {
        duration: Math.max(4, Math.min(15, Number(body.duration) || 5)),
        aspectRatio: "9:16",
        references: [{ role: "product photo", fileName: "product-reference", url: referenceUrl, contentType: "image/png" }]
      });
      return NextResponse.json({ taskId });
    }

    if (action === "status") {
      const taskId = String(body.taskId || "");
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(taskId)) return NextResponse.json({ error: "Invalid task ID." }, { status: 400 });
      return NextResponse.json(await getMarketTask(taskId));
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Direct KIE request failed." }, { status: 502 });
  }
}
