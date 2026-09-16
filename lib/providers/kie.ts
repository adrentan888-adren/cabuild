import { getProviderApiKey } from "@/lib/apiKeyOverrides";

type KieGenerateResponse = {
  code: number;
  msg: string;
  data?: { taskId?: string };
};

type KieStatusResponse = {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    successFlag: 0 | 1 | 2 | 3;
    response?: {
      resultUrls?: string[];
      fullResultUrls?: string[];
      originUrls?: string[];
      resolution?: string;
    };
    errorMessage?: string;
  };
};

type KieMarketTaskResponse = {
  code: number;
  msg: string;
  data?: { taskId?: string };
};

type KieMarketStatusResponse = {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    state: "waiting" | "queuing" | "generating" | "success" | "fail";
    resultJson?: string;
    failMsg?: string;
    failCode?: string;
    progress?: number;
  };
};

type KieResponsesResponse = {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  status?: string;
  error?: { message?: string };
};

const baseUrl = "https://api.kie.ai";

export type KieReferenceAsset = {
  role?: string;
  fileName?: string;
  url?: string;
  contentType?: string;
};

async function token() {
  return getProviderApiKey("kie");
}

export async function hasKie() {
  return Boolean(await token());
}

function referenceUrls(refs?: KieReferenceAsset[]) {
  return (refs || [])
    .slice()
    .sort((a, b) => {
      const priority = (role?: string) => role === "logo" ? 0 : role === "product photo" ? 1 : role === "avatar/persona" ? 2 : 3;
      return priority(a.role) - priority(b.role);
    })
    .filter((ref) => !ref.contentType || ref.contentType.startsWith("image/"))
    .map((ref) => ref.url?.trim())
    .filter((url): url is string => Boolean(url));
}

export async function generateVeoVideo(prompt: string, options: { duration?: number; aspectRatio?: string; references?: KieReferenceAsset[] } = {}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const imageUrls = referenceUrls(options.references).slice(0, 3);
  const res = await fetch(`${baseUrl}/api/v1/veo/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      model: "veo3_fast",
      ...(imageUrls.length ? { imageUrls, generationType: "REFERENCE_2_VIDEO" } : { generationType: "TEXT_2_VIDEO" }),
      aspect_ratio: options.aspectRatio || "9:16",
      resolution: "720p",
      duration: options.duration || 8,
      enableTranslation: true,
      watermark: "ContentAgent"
    })
  });
  const json = (await res.json()) as KieGenerateResponse;
  if (!res.ok || json.code !== 200 || !json.data?.taskId) {
    throw new Error(json.msg || `Kie generation failed with HTTP ${res.status}.`);
  }
  return json.data.taskId;
}

export async function generateSeedanceVideo(prompt: string, options: { duration?: number; aspectRatio?: string; references?: KieReferenceAsset[] } = {}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const duration = Math.max(4, Math.min(15, Math.round(options.duration || 8)));
  const imageUrls = referenceUrls(options.references).slice(0, 2);
  const res = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "bytedance/seedance-2",
      input: {
        prompt,
        ...(imageUrls.length ? { reference_image_urls: imageUrls } : {}),
        generate_audio: true,
        resolution: "720p",
        aspect_ratio: options.aspectRatio || "9:16",
        duration,
        web_search: false
      }
    })
  });
  const json = (await res.json()) as KieMarketTaskResponse;
  if (!res.ok || json.code !== 200 || !json.data?.taskId) {
    throw new Error(json.msg || `Kie Seedance generation failed with HTTP ${res.status}.`);
  }
  return json.data.taskId;
}

export async function generateImage(prompt: string, options: { model?: string; aspectRatio?: string; references?: KieReferenceAsset[] } = {}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const imageUrls = referenceUrls(options.references);
  const model = options.model === "gpt-image-2"
    ? imageUrls.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image"
    : "nano-banana-pro";
  const aspectRatio = normalizeAspectRatio(options.aspectRatio);
  const input = model === "nano-banana-pro"
    ? { prompt, image_input: imageUrls, aspect_ratio: aspectRatio, resolution: "1K", output_format: "png" }
    : model === "gpt-image-2-image-to-image"
      ? { prompt, input_urls: imageUrls, aspect_ratio: aspectRatio }
      : { prompt, aspect_ratio: aspectRatio };
  const res = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input })
  });
  const json = (await res.json()) as KieMarketTaskResponse;
  if (!res.ok || json.code !== 200 || !json.data?.taskId) {
    throw new Error(json.msg || `Kie image generation failed with HTTP ${res.status}.`);
  }
  return json.data.taskId;
}

function normalizeAspectRatio(value?: string) {
  return value === "1:1" || value === "4:5" || value === "16:9" || value === "9:16" ? value : "1:1";
}

export async function getVeoVideo(taskId: string) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const url = new URL(`${baseUrl}/api/v1/veo/record-info`);
  url.searchParams.set("taskId", taskId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  const json = (await res.json()) as KieStatusResponse;
  if (!res.ok || json.code !== 200 || !json.data) {
    throw new Error(json.msg || `Kie status check failed with HTTP ${res.status}.`);
  }
  const urls = json.data.response?.resultUrls || json.data.response?.fullResultUrls || json.data.response?.originUrls || [];
  return {
    taskId: json.data.taskId,
    successFlag: json.data.successFlag,
    assetUrl: urls[0],
    error: json.data.errorMessage || ""
  };
}

export async function getMarketTask(taskId: string) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const url = new URL(`${baseUrl}/api/v1/jobs/recordInfo`);
  url.searchParams.set("taskId", taskId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  const json = (await res.json()) as KieMarketStatusResponse;
  if (!res.ok || !json.data) {
    throw new Error(json.msg || `Kie task status check failed with HTTP ${res.status}.`);
  }
  let resultUrls: string[] = [];
  if (json.data.resultJson) {
    try {
      const parsed = JSON.parse(json.data.resultJson) as { resultUrls?: string[]; videoUrl?: string; video?: { url?: string } };
      resultUrls = parsed.resultUrls || (parsed.videoUrl ? [parsed.videoUrl] : parsed.video?.url ? [parsed.video.url] : []);
    } catch {
      resultUrls = [];
    }
  }
  return {
    taskId: json.data.taskId,
    state: json.data.state,
    progress: json.data.progress || 0,
    assetUrl: resultUrls[0],
    error: json.data.failMsg || json.data.failCode || ""
  };
}

export async function checkKieHealth() {
  return { configured: await hasKie(), baseUrl };
}

type PlanInput = {
  title: string;
  url: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string;
  description?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  mediaType?: string;
  niche?: string;
  personaContext?: string;
};

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(raw);
}

export function buildAiBriefPrompt(input: { idea: string; niche: string; requestedFormat?: string; requestedDuration?: number; requestedModel?: string; personaContext?: string }) {
  const durationLine = input.requestedDuration && input.requestedFormat?.toLowerCase().includes("video")
    ? `\nSelected video model/duration:\n${input.requestedModel || "selected video model"} supports the selected ${input.requestedDuration}-second output. The JSON "duration" must be ${input.requestedDuration}. The videoPrompt, outline, hooks, and shotList must be feasible inside exactly ${input.requestedDuration} seconds. Do not request 25-30 seconds, long scenes, or more than ${input.requestedDuration <= 8 ? "3" : "5"} scenes.`
    : "";
  const requestedFormatLine = input.requestedFormat
    ? `\nRequired content format:\n${input.requestedFormat}\n\nYou must set the JSON "format" exactly to "${input.requestedFormat}". All generated fields must match this format. If it is video, write a video creation prompt with scenes, motion, pacing, and duration. If it is image, write an image generation prompt with composition, layout, aspect ratio, and visual direction. If it is text, write text-post fields and do not describe video/image production unless useful as creative notes.${durationLine}`
    : "";
  return `You are ContentAgent's senior social content strategist.

User request:
${input.idea}

Brand/niche:
${input.niche || "No brand/niche set. Follow the user request exactly and do not assume a niche."}
${input.personaContext ? `\nPersona context:\n${input.personaContext}\n` : ""}
${requestedFormatLine}

Create a complete editable content plan. Return ONLY valid JSON with this exact shape:
{
  "topic": "specific title/topic",
  "format": "one of: Short video 9:16, Long-form video 16:9, Image 1:1, Image 4:5, Image 16:9, Image 9:16, Text post, Long-form article",
  "description": "concise strategic description",
  "videoPrompt": "detailed generation prompt if video/image; for text/article, describe the creative direction",
  "duration": 8,
  "hooks": ["hook 1", "hook 2", "hook 3"],
  "outline": ["section or scene 1", "section or scene 2", "section or scene 3", "section or scene 4"],
  "shotList": ["shot or visual 1", "shot or visual 2", "shot or visual 3", "shot or visual 4"],
  "creativeNotes": "visual style, pacing, edit notes, CTA, compliance notes",
  "caption": "ready-to-use caption",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "optimalTime": "day and time",
  "expectedPerformance": "estimated engagement range",
  "analysisSummary": "why this plan should work"
}`;
}

export class KieBriefError extends Error {
  constructor(message: string, public readonly userMessage: string, public readonly retryable = false) {
    super(message);
    this.name = "KieBriefError";
  }
}

export async function generateContentPlanWithGpt55(input: { idea: string; niche: string; requestedFormat?: string; requestedDuration?: number; requestedModel?: string; personaContext?: string }, prompt = buildAiBriefPrompt(input)) {
  const apiToken = await token();
  if (!apiToken) throw new KieBriefError("KIE_API_TOKEN is not configured.", "The brief service is not configured. Check the provider settings or write your brief manually.");
  const unavailable = "Kie’s brief service is temporarily unavailable. Your idea is still here. Try again shortly, or write the brief manually.";
  const invalid = "Kie returned an incomplete brief. Your idea is still here. Try again, or write the brief manually.";
  // Only retry an explicit server rejection, never an ambiguous network timeout.
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    let res: Response;
    try {
      res = await fetch(baseUrl + "/codex/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(90_000),
        headers: { Authorization: "Bearer " + apiToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-5", stream: false,
          input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
          reasoning: { effort: "medium" }
        })
      });
      text = await res.text();
    } catch (error) {
      throw new KieBriefError("Kie GPT-5.5 connection failed: " + (error instanceof Error ? error.message : "Unknown network error"), "The connection to Kie was interrupted. Your idea is still here. Check Logs before trying again, or write the brief manually.");
    }
    const transient = [500, 502, 503, 504].includes(res.status);
    if (!res.ok) {
      if (transient && attempt === 0) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(1000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000))));
        continue;
      }
      throw new KieBriefError("Kie GPT-5.5 failed with HTTP " + res.status + ": " + text.slice(0, 180),
        transient ? unavailable : res.status === 401 || res.status === 403 ? "Kie could not authorize the brief request. Check the provider key in Settings, or write your brief manually." : res.status === 429 ? "Kie’s brief service is busy or its quota has been reached. Try again later, or check the provider account." : "Kie could not generate this brief. Your idea is still here. Check Logs for details, or write the brief manually.", transient || res.status === 429);
    }
    let parsed: KieResponsesResponse;
    try { parsed = JSON.parse(text) as KieResponsesResponse; }
    catch { throw new KieBriefError("Kie GPT-5.5 returned invalid response JSON.", invalid, true); }
    if (!parsed || parsed.error || (parsed.status && parsed.status !== "completed")) {
      throw new KieBriefError("Kie GPT-5.5 did not complete: " + (parsed?.error?.message || parsed?.status || "Empty response"), invalid, true);
    }
    const content = (Array.isArray(parsed.output) ? parsed.output : [])
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item.type === "output_text" && typeof item.text === "string")
      .map(item => item.text).join("").trim();
    let plan: Record<string, unknown>;
    try { plan = extractJson(content) as Record<string, unknown>; }
    catch { throw new KieBriefError("Kie GPT-5.5 returned no valid brief JSON.", invalid, true); }
    if (!plan || Array.isArray(plan) || typeof plan.topic !== "string" || !plan.topic.trim() || typeof plan.videoPrompt !== "string" || !plan.videoPrompt.trim()) {
      throw new KieBriefError("Kie GPT-5.5 brief is missing a topic or creation prompt.", invalid, true);
    }
    return plan;
  }
  throw new KieBriefError("Kie GPT-5.5 retries exhausted.", unavailable, true);
}

const fallbackVideoPromptRefineTemplate = `You are ContentAgent's senior video prompt engineer.

Convert the user's research recreation instruction into ONE final provider-ready video generation prompt.

Rules:
- Return ONLY valid JSON with this shape: {"videoPrompt":"..."}
- The videoPrompt must be no more than 3000 characters.
- Preserve the selected duration requirement exactly if present, for example: "the video duration is supposed to be 8s".
- Keep any source video/page context that helps recreate the structure, pacing, camera, hook, and conversion angle.
- If user-uploaded references are mentioned, use only those attached assets for logo/person/audio replacement.
- If no matching user attachment is provided, instruct the model to remove the original logo, change the person, and change or replace the audio.
- Optimize for high-conversion social media output: strong 0-3 second hook, clear USP, platform-native pacing, readable mobile framing, CTA, and compliance-safe wording.
- Do not copy protected identity, exact creator likeness, original brand/logo, or original audio unless the user explicitly provided replacement references.

User instruction to transform:
{{prompt}}`;

export function buildFinalVideoPromptInstruction(prompt: string, template?: string) {
  const source = (template || fallbackVideoPromptRefineTemplate).trim();
  if (source.includes("{{prompt}}")) return source.replace(/\{\{prompt\}\}/g, prompt);
  return `${source}\n\nUser instruction to transform:\n${prompt}`;
}

export async function generateFinalVideoPromptWithGpt55(prompt: string, template?: string) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const instruction = buildFinalVideoPromptInstruction(prompt, template);
  const res = await fetch(`${baseUrl}/codex/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5-5",
      stream: false,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: instruction }]
        }
      ],
      reasoning: { effort: "medium" }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie GPT-5.5 video prompt failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text) as KieResponsesResponse;
  if (parsed.error?.message) throw new Error(parsed.error.message);
  const content = (parsed.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join("")
    .trim();
  const raw = content || text;
  try {
    const json = extractJson(raw) as { videoPrompt?: unknown };
    const videoPrompt = String(json.videoPrompt || "").trim();
    if (videoPrompt) return { videoPrompt, debugJson: JSON.stringify({ videoPrompt }, null, 2) };
  } catch {
    // Fall through to a cleaned text response when the provider returns plain text.
  }
  const videoPrompt = raw.replace(/```(?:json)?/gi, "").trim().slice(0, 3000);
  return { videoPrompt, debugJson: JSON.stringify({ videoPrompt }, null, 2) };
}

export async function generatePersonaAutofillWithGpt55(prompt: string) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const res = await fetch(`${baseUrl}/codex/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5-5",
      stream: false,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      reasoning: { effort: "medium" }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie GPT-5.5 persona autofill failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text) as KieResponsesResponse;
  if (parsed.error?.message) throw new Error(parsed.error.message);
  const content = (parsed.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join("")
    .trim();
  const json = extractJson(content || text) as Record<string, unknown>;
  const code = json.code || json.statusCode || json.status;
  const message = String(json.msg || json.message || json.error || "");
  if ((typeof code === "number" && code >= 400) || /server exception|failed|error/i.test(message)) {
    throw new Error(message || `Kie GPT-5.5 persona autofill returned ${code}`);
  }
  return json;
}

export function buildContentPlanPrompt(input: PlanInput) {
  return `You are ContentAgent's social content strategist. Analyze this competitor post and return ONLY valid JSON.

Competitor post:
Title: ${input.title}
Description: ${input.description || ""}
URL: ${input.url}
Thumbnail URL: ${input.thumbnailUrl || ""}
Direct media URL, if available: ${input.mediaUrl || ""}
Media type: ${input.mediaType || "unknown"}
Platform: ${input.platform}
Views: ${input.views}
Likes: ${input.likes}
Comments: ${input.comments}
Published at: ${input.publishedAt}

Create a content plan for this brand/niche: ${input.niche || "No brand/niche set. Follow the source post and user context without assuming a niche."}
${input.personaContext ? `\nPersona context:\n${input.personaContext}` : ""}
Use the competitor post as the source creative reference. If a direct media URL or thumbnail URL is available, infer the content format and visual direction from that exact source media rather than from the profile/page alone.
Return this JSON shape:
{
  "topic": "specific content topic",
  "format": "Short video 9:16 or Carousel or Text post",
  "platforms": ["TikTok", "Instagram", "Facebook"],
  "description": "concise strategic description of the recreated content",
  "videoPrompt": "detailed generation prompt for a vertical social video, including subject, setting, shots, motion, text overlays, tone, and ending",
  "duration": 8,
  "hooks": ["hook 1", "hook 2", "hook 3"],
  "outline": ["scene or section 1", "scene or section 2", "scene or section 3", "scene or section 4"],
  "shotList": ["shot 1", "shot 2", "shot 3", "shot 4"],
  "creativeNotes": "visual style, pacing, editing, B-roll, CTA, and compliance notes",
  "caption": "ready-to-use caption",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "optimalTime": "day and time",
  "expectedPerformance": "estimated engagement range",
  "analysisSummary": "why this angle should work"
}`;
}

export async function generateContentPlanWithGemini(input: PlanInput, prompt = buildContentPlanPrompt(input)) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");

  const res = await fetch(`${baseUrl}/gemini/v1/models/gemini-3-5-flash:streamGenerateContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stream: false,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { includeThoughts: false, thinkingLevel: "medium" }
      }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie Gemini failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text);
  const content = parsed?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || text;
  return extractJson(content);
}
