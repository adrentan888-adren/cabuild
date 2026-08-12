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

export type KieGeneratedTextContent = {
  title: string;
  body: string;
  caption: string;
  hashtags: string[];
  raw: string;
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

function audioReferenceUrls(refs?: KieReferenceAsset[]) {
  return (refs || [])
    .filter((ref) => ref.role === "audio" || ref.contentType?.startsWith("audio/"))
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
  const audioUrls = audioReferenceUrls(options.references).slice(0, 1);
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
        ...(audioUrls.length ? { reference_audio_urls: audioUrls } : {}),
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

export async function generateSeedanceMiniVideo(prompt: string, options: { duration?: number; aspectRatio?: string; references?: KieReferenceAsset[] } = {}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const duration = Math.max(4, Math.min(15, Math.round(options.duration || 8)));
  const imageUrls = referenceUrls(options.references).slice(0, 2);
  const audioUrls = audioReferenceUrls(options.references).slice(0, 1);
  const res = await fetch(`${baseUrl}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "bytedance/seedance-2-mini",
      input: {
        prompt,
        ...(imageUrls.length ? { reference_image_urls: imageUrls } : {}),
        ...(audioUrls.length ? { reference_audio_urls: audioUrls } : {}),
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
    throw new Error(json.msg || `Kie Seedance Mini generation failed with HTTP ${res.status}.`);
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

export async function generateTextContentWithKie(prompt: string, options: { model?: string; caption?: string; hashtags?: string[] } = {}): Promise<KieGeneratedTextContent> {
  const apiToken = await token();
  if (!apiToken) throw new Error("KIE_API_TOKEN is not configured.");
  const model = options.model || "gemini-3.5-flash";
  const instruction = `You are ContentAgent's senior social copywriter.

Create the final text-based social content from this editable brief.

Return ONLY valid JSON with this exact shape:
{
  "title": "short internal title",
  "body": "final post body ready to publish",
  "caption": "caption or first post text",
  "hashtags": ["#tag1", "#tag2", "#tag3"]
}

Rules:
- Keep it original and platform-native.
- Preserve the user's language, offer, CTA, compliance constraints, and persona context.
- If a caption or hashtags are provided, improve them instead of ignoring them.
- Do not mention video/image production unless the brief explicitly asks for it.

Editable brief:
${prompt}

Existing caption:
${options.caption || ""}

Existing hashtags:
${(options.hashtags || []).join(" ")}`;

  const raw = model === "gemini-3.5-flash"
    ? await generateGeminiText(apiToken, instruction)
    : await generateResponsesText(apiToken, model === "gpt-5-5" ? "gpt-5-5" : model, instruction);
  return normalizeGeneratedText(raw, options);
}

async function generateResponsesText(apiToken: string, model: string, instruction: string) {
  const res = await fetch(`${baseUrl}/codex/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
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
  if (!res.ok) throw new Error(`Kie ${model} text generation failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text) as KieResponsesResponse;
  if (parsed.error?.message) throw new Error(parsed.error.message);
  return (parsed.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join("")
    .trim() || text;
}

async function generateGeminiText(apiToken: string, instruction: string) {
  const res = await fetch(`${baseUrl}/gemini/v1/models/gemini-3-5-flash:streamGenerateContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stream: false,
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { includeThoughts: false, thinkingLevel: "medium" }
      }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie Gemini text generation failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text);
  return parsed?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim() || text;
}

function normalizeGeneratedText(raw: string, options: { caption?: string; hashtags?: string[] }): KieGeneratedTextContent {
  try {
    const json = extractJson(raw) as Record<string, unknown>;
    const body = String(json.body || json.post || json.text || json.caption || "").trim();
    const caption = String(json.caption || body || options.caption || "").trim();
    const tags = Array.isArray(json.hashtags)
      ? json.hashtags.map((tag) => String(tag).trim()).filter(Boolean)
      : String(json.hashtags || (options.hashtags || []).join(" ")).split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
    return {
      title: String(json.title || caption.split(/\n|\.|\?/)[0] || "Generated text post").slice(0, 120),
      body: body || caption,
      caption,
      hashtags: tags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`),
      raw
    };
  } catch {
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    return {
      title: cleaned.split(/\n|\.|\?/)[0].slice(0, 120) || "Generated text post",
      body: cleaned,
      caption: cleaned || options.caption || "",
      hashtags: options.hashtags || [],
      raw
    };
  }
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

export async function generateContentPlanWithGpt55(input: { idea: string; niche: string; requestedFormat?: string; requestedDuration?: number; requestedModel?: string; personaContext?: string }, prompt = buildAiBriefPrompt(input)) {
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
  if (!res.ok) throw new Error(`Kie GPT-5.5 failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
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
    throw new Error(message || `Kie GPT-5.5 returned ${code}`);
  }
  return json;
}

export async function generateUgcStoryboardWithGpt55(input: {
  productName: string;
  sellingPoints: string;
  audience: string;
  style: string;
  language: string;
  duration: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  template: string;
}) {
  const prompt = `${input.template}\n\nProduct name: ${input.productName}\nProduct facts, selling points, and restrictions: ${input.sellingPoints || "Show only defensible benefits."}\nTarget audience: ${input.audience || "The product's intended customer."}\nStyle: ${input.style}\nDialogue language: ${input.language}\nAspect ratio: ${input.aspectRatio}\nTotal duration: exactly 15 seconds\nRequired scene count: exactly 3\n\nReturn ONLY valid JSON in this shape:\n{"concept":"...","caption":"...","hashtags":["#tag"],"scenes":[{"title":"...","prompt":"detailed visual, camera, transition, and spoken-dialogue direction","duration":4}]}\nThe three durations must each be at least 1 second and must add up to exactly 15 seconds.`;
  const requestedFormat = input.aspectRatio === "16:9" ? "Long-form video 16:9" : input.aspectRatio === "1:1" ? "Square video 1:1" : "Short video 9:16";
  const result = await generateContentPlanWithGpt55({ idea: prompt, niche: "UGC product advertising", requestedFormat, requestedDuration: 15, requestedModel: "seedance-2.0" }, prompt);
  return result as {
    concept?: string;
    caption?: string;
    hashtags?: string[];
    scenes?: Array<{ title?: string; prompt?: string; dialogue?: string; duration?: number }>;
  };
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
