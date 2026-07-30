import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const base = "https://api.kie.ai";
const headers = () => ({ Authorization: `Bearer ${token()}` });

function token() {
  if (!process.env.KIE_API_TOKEN) throw new Error("KIE_API_TOKEN is not configured.");
  return process.env.KIE_API_TOKEN;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return uploadProduct(request);
    const body = await request.json();
    if (body.action === "plan") return plan(body);
    if (body.action === "start") return start(body);
    if (body.action === "status") return status(body);
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "KIE request failed." }, { status: 502 });
  }
}

async function uploadProduct(request: Request) {
  const source = await request.formData();
  const file = source.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "A valid product image is required." }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Product image must be under 15 MB." }, { status: 413 });
  const form = new FormData();
  form.set("file", file);
  form.set("uploadPath", "product-video-studio");
  form.set("fileName", `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`);
  const response = await fetch("https://kieai.redpandaai.co/api/file-stream-upload", { method: "POST", headers: headers(), body: form });
  const json = await response.json().catch(() => ({}));
  const url = json?.data?.downloadUrl || json?.data?.fileUrl;
  if (!response.ok || !url) throw new Error(json?.msg || `KIE upload failed (${response.status}).`);
  return NextResponse.json({ url });
}

async function plan(body: Record<string, unknown>) {
  const productName = String(body.productName || "").trim();
  if (!productName) return NextResponse.json({ error: "Product name is required." }, { status: 400 });
  const duration = Math.max(8, Math.min(30, Number(body.duration) || 20));
  const sceneCount = duration <= 8 ? 2 : duration <= 20 ? 4 : 6;
  const instruction = `You are a senior product-video strategist.
Create a ${duration}-second vertical 9:16 ${String(body.style || "UGC product demo")} for ${productName}.
Audience: ${String(body.audience || "the product's ideal customer")}.
Selling points and restrictions: ${String(body.sellingPoints || "Show only defensible product benefits")}.
Dialogue language: ${String(body.language || "Malay")}.
Return ONLY valid JSON:
{"concept":"...","caption":"...","hashtags":["#tag"],"scenes":[{"title":"...","prompt":"provider-ready visual and spoken-dialogue direction"}]}
Return exactly ${sceneCount} scenes. Use a strong hook, product demonstration, consistent product identity, natural dialogue, compliance-safe claims, and a clear CTA. Never request generated captions, overlays, labels, watermarks, or extra readable text.`;
  const response = await fetch(`${base}/codex/v1/responses`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5-5", stream: false, input: [{ role: "user", content: [{ type: "input_text", text: instruction }] }], reasoning: { effort: "medium" } })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GPT-5.5 failed (${response.status}): ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text);
  const raw = (parsed.output || []).flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("").trim();
  const jsonText = raw.match(/```json\s*([\s\S]*?)```/i)?.[1] || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  return NextResponse.json({ plan: JSON.parse(jsonText) });
}

async function start(body: Record<string, unknown>) {
  const prompt = String(body.prompt || "").trim();
  const referenceUrl = String(body.referenceUrl || "").trim();
  if (prompt.length < 20 || !/^https?:\/\//i.test(referenceUrl)) {
    return NextResponse.json({ error: "A detailed prompt and uploaded product reference are required." }, { status: 400 });
  }
  const response = await fetch(`${base}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ model: "bytedance/seedance-2", input: { prompt, reference_image_urls: [referenceUrl], generate_audio: true, resolution: "720p", aspect_ratio: "9:16", duration: Math.max(4, Math.min(15, Number(body.duration) || 5)), web_search: false } })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.code !== 200 || !json.data?.taskId) throw new Error(json.msg || `Seedance failed (${response.status}).`);
  return NextResponse.json({ taskId: json.data.taskId });
}

async function status(body: Record<string, unknown>) {
  const taskId = String(body.taskId || "");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(taskId)) return NextResponse.json({ error: "Invalid task ID." }, { status: 400 });
  const url = new URL(`${base}/api/v1/jobs/recordInfo`);
  url.searchParams.set("taskId", taskId);
  const response = await fetch(url, { headers: headers(), cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.data) throw new Error(json.msg || `Status failed (${response.status}).`);
  let resultUrls: string[] = [];
  try {
    const result = JSON.parse(json.data.resultJson || "{}");
    resultUrls = result.resultUrls || [];
  } catch {}
  return NextResponse.json({ taskId, state: json.data.state, progress: Number(json.data.progress || 0), assetUrl: resultUrls[0], error: json.data.failMsg || json.data.failCode || "" });
}
