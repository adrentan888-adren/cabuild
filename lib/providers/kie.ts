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

const baseUrl = "https://api.kie.ai";

function token() {
  return process.env.KIE_API_TOKEN;
}

export function hasKie() {
  return Boolean(token());
}

export async function generateVeoVideo(prompt: string, options: { duration?: number; aspectRatio?: string } = {}) {
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
  const res = await fetch(`${baseUrl}/api/v1/veo/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      model: "veo3_fast",
      generationType: "TEXT_2_VIDEO",
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

export async function generateContentPlanWithGemini(input: PlanInput) {
  if (!token()) throw new Error("KIE_API_TOKEN is not configured.");
  const prompt = `You are ContentAgent's social content strategist. Analyze this competitor post and return ONLY valid JSON.

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
