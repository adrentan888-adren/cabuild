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

const baseUrl = "https://api.kie.ai";

export type KieReferenceAsset = {
  role?: string;
  fileName?: string;
  url?: string;
};

function token() {
  return process.env.KIE_API_TOKEN;
}

export function hasKie() {
  return Boolean(token());
}

function referenceUrls(refs?: KieReferenceAsset[]) {
  return (refs || [])
    .map((ref) => ref.url?.trim())
    .filter((url): url is string => Boolean(url));
}

export async function generateVeoVideo(prompt: string, options: { duration?: number; aspectRatio?: string; references?: KieReferenceAsset[] } = {}) {
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
  const imageUrls = referenceUrls(options.references).slice(0, 3);
  const res = await fetch(`${baseUrl}/api/v1/veo/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
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
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
  const duration = Math.max(4, Math.min(15, Math.round(options.duration || 8)));
  const imageUrls = referenceUrls(options.references).slice(0, 2);
  const res = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
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
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
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
      Authorization: `Bearer ${token()}`,
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
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
  const url = new URL(`${baseUrl}/api/v1/veo/record-info`);
  url.searchParams.set("taskId", taskId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
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
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
  const url = new URL(`${baseUrl}/api/v1/jobs/recordInfo`);
  url.searchParams.set("taskId", taskId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
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
  return { configured: hasKie(), baseUrl };
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
};

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(raw);
}

export function buildContentPlanPrompt(input: PlanInput) {
  return `You are ContentAgent's social content strategist. Analyze this competitor post and return ONLY valid JSON.

Competitor post:
Title: ${input.title}
Description: ${input.description || ""}
URL: ${input.url}
Platform: ${input.platform}
Views: ${input.views}
Likes: ${input.likes}
Comments: ${input.comments}
Published at: ${input.publishedAt}

Create a content plan for a founder-led SME AI automation brand. Return this JSON shape:
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
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");

  const res = await fetch(`${baseUrl}/gemini/v1/models/gemini-3-5-flash:streamGenerateContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
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
