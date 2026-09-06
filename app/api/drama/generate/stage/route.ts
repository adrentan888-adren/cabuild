import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProviderApiKey } from "@/lib/apiKeyOverrides";

export const runtime = "nodejs";

type GenerationRequest = {
  targetStage?: number;
  model?: string;
  snapshot?: {
    title?: string;
    roughStory?: string;
    seedPrompt?: string;
    continuity?: string;
    generatedBrief?: string;
    episodes?: number;
    episodeLength?: number;
    style?: string;
    language?: string;
    aspectRatio?: string;
    pacing?: string;
    audience?: string;
    rating?: string;
    tone?: string[];
    storyline?: string;
    episodePlan?: Array<{
      number?: number;
      title?: string;
      summary?: string;
    }>;
    characters?: Array<{
      name?: string;
      role?: string;
      appearance?: string;
      personality?: string;
      arc?: string;
    }>;
    assets?: Array<{
      name?: string;
      type?: string;
      detail?: string;
    }>;
  };
};

const chatModels = {
  "gemini-3-pro": {
    label: "Gemini 3 Pro",
    endpoint: "/gemini-3-pro/v1/chat/completions",
    reasoning: true,
  },
  "gemini-2.5-flash": {
    label: "Gemini 2.5 Flash",
    endpoint: "/gemini-2.5-flash/v1/chat/completions",
    reasoning: false,
  },
} as const;

type ChatModelId = keyof typeof chatModels;

const schemas = {
  0: {
    name: "creative_seed",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "roughStory"],
      properties: {
        title: { type: "string" },
        roughStory: { type: "string" },
      },
    },
  },
  1: {
    name: "finished_creative_brief",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["brief"],
      properties: {
        brief: { type: "string" },
      },
    },
  },
  2: {
    name: "story_bible",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["storyline", "episodes", "characters", "assets"],
      properties: {
        storyline: { type: "string" },
        episodes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["number", "title", "summary"],
            properties: {
              number: { type: "integer" },
              title: { type: "string" },
              summary: { type: "string" },
            },
          },
        },
        characters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "role",
              "appearance",
              "personality",
              "arc",
            ],
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              appearance: { type: "string" },
              personality: { type: "string" },
              arc: { type: "string" },
            },
          },
        },
        assets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "assetType", "detail", "visualPrompt"],
            properties: {
              name: { type: "string" },
              assetType: {
                type: "string",
                enum: ["Character", "Venue", "Object"],
              },
              detail: { type: "string" },
              visualPrompt: { type: "string" },
            },
          },
        },
      },
    },
  },
  3: {
    name: "visual_asset_pack",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["assets"],
      properties: {
        assets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "assetType", "detail", "visualPrompt"],
            properties: {
              name: { type: "string" },
              assetType: {
                type: "string",
                enum: ["Character", "Venue", "Object"],
              },
              detail: { type: "string" },
              visualPrompt: { type: "string" },
            },
          },
        },
      },
    },
  },
  4: {
    name: "scene_prompt_set",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["scenes"],
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "episode",
              "title",
              "duration",
              "prompt",
              "safety",
            ],
            properties: {
              id: { type: "string" },
              episode: { type: "integer" },
              title: { type: "string" },
              duration: { type: "integer" },
              prompt: { type: "string" },
              safety: { type: "string", enum: ["Clear", "Review"] },
            },
          },
        },
      },
    },
  },
} as const;

function stageContext(
  targetStage: 0 | 1 | 2 | 3 | 4,
  snapshot: GenerationRequest["snapshot"],
) {
  const source = snapshot ?? {};
  const creativeDirection = {
    title: source.title,
    roughStory: source.roughStory,
    ...(targetStage === 0 ? { seedPrompt: typeof source.seedPrompt === "string" ? source.seedPrompt.slice(0, 2000) : "" } : {}),
    continuity: ["Strict", "Balanced", "Flexible"].includes(source.continuity ?? "") ? source.continuity : "Strict",
    episodes: source.episodes,
    episodeLength: source.episodeLength,
    style: source.style,
    language: source.language,
    aspectRatio: source.aspectRatio,
    pacing: source.pacing,
    audience: source.audience,
    rating: source.rating,
    tone: source.tone,
  };

  if (targetStage === 0 || targetStage === 1) return creativeDirection;
  if (targetStage === 2) {
    return {
      ...creativeDirection,
      generatedBrief: source.generatedBrief,
    };
  }
  if (targetStage === 3) {
    return {
      ...creativeDirection,
      storyline: source.storyline,
      episodePlan: source.episodePlan,
      characters: source.characters,
    };
  }
  return {
    ...creativeDirection,
    storyline: source.storyline,
    episodePlan: source.episodePlan,
    characters: source.characters,
    assets: source.assets,
  };
}

function stagePrompt(
  targetStage: 0 | 1 | 2 | 3 | 4,
  snapshot: GenerationRequest["snapshot"],
) {
  const context = JSON.stringify(stageContext(targetStage, snapshot), null, 2);
  if (targetStage === 0) {
    return `Create or regenerate an original episodic drama seed from the current
creative direction. Return a short, memorable working title and a compelling
rough story or premise. The premise must clearly establish all three essentials:
the protagonist and what they want, the central conflict and its stakes, and the
specific rule, place, era, culture, or situation that makes this world feel
different. Make the dramatic engine strong enough to sustain the requested
number and length of episodes. Treat any existing title or premise as optional
inspiration, make fresh creative choices instead of merely paraphrasing it, and
respect the selected genre, audience, rating, language, tone, and pacing. Keep
the premise focused and useful as editable creator input rather than formatting
it as a finished creative brief. Follow the creator's seedPrompt as additional
direction when provided, and respect the selected continuity strength.

CURRENT CREATIVE DIRECTION:
${context}`;
  }
  if (targetStage === 1) {
    return `Turn these creator inputs into a polished, production-ready creative
brief. The finished brief—not the rough prompt—is the deliverable. Use clear
sections for premise, hook, world, protagonist, central conflict, episode format,
visual direction, audience, tone, pacing, content boundaries, and continuity
rules. Preserve the creator's intent and write in the requested language. Invent
names only from these creator inputs; never import characters, names, stories, or
examples from another production.

CREATOR INPUTS:
${context}`;
  }
  if (targetStage === 2) {
    return `Create the complete production plan from the selected finished
creative brief. Return one cohesive full-season storyline, exactly the requested
number of episodes, a detailed beginning-to-end storyline for every episode in
the episode summary field, and 3-6 recurring character designs. Also return the
complete visual asset plan needed to produce the series: one Character asset for
every named recurring character using the exact same name, plus all essential
recurring venues and signature objects. Every visualPrompt must be unique,
standalone, continuity-safe, and specific enough for high-quality image
generation. Keep the requested language, rating, tone, duration, pacing, visual
style and character identity consistent across the whole season. Do not include
aspect-ratio instructions such as 9:16 or 16:9 inside any visualPrompt; image
dimensions are supplied separately by the image-generation setting.
Every character and asset must be grounded in the selected finished brief. Never
reuse names or characters from a different production or an internal example.

SELECTED FINISHED BRIEF:
${context}`;
  }
  if (targetStage === 3) {
    return `Create a reusable visual asset pack from this selected story bible.
Include 4-8 essential recurring characters, venues, and signature objects. Every
visualPrompt must stand alone as a high-quality text-to-image prompt and preserve
the production's era, palette, character identity, and continuity. Do not write
an aspect ratio inside visualPrompt because dimensions are applied separately.
Every asset must have a genuinely asset-specific visualPrompt: explicitly name
the one intended subject, describe its unique appearance and reference-sheet
composition, and never reuse the same prompt, subject, or composition for two
different assets.

SELECTED STORY BIBLE:
${context}`;
  }
  return `Turn this approved story, character bible, and visual asset plan into
model-ready video scene prompts for every episode in the episode plan. Each scene
must be no longer than 15 seconds. Include the episode number in every scene and
use unique sequential scene IDs. Write explicit camera, subject, action, setting,
lighting, continuity, and motion details. Mark potentially restricted or
sensitive scenes as Review. For each episode, make scene durations add up closely
to the requested episode length.

SELECTED PRODUCTION CONTEXT:
${context}`;
}

function safeProviderMessage(status: number) {
  if (status === 401 || status === 403) {
    return "Kie AI rejected this key. Update the saved KIE AI Key and try again.";
  }
  if (status === 429) {
    return "Kie AI is rate-limiting this workspace or has insufficient credits. Review the Kie account and retry.";
  }
  if (status >= 500) {
    return "Kie AI is temporarily unavailable. Try this generation again.";
  }
  return "Kie AI could not generate this production stage. Review the selected source and settings.";
}

function safeLogValue(value?: string, limit = 600) {
  return (
    value
      ?.replace(/bearer\s+\S+/gi, "credential")
      .replace(/key\s*[:=]\s*\S+/gi, "key")
      .trim()
      .slice(0, limit) ?? ""
  );
}

type KieChatResponse = {
  code?: number | string;
  msg?: string;
  data?: KieChatResponse;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string | { value?: string };
            content?: string;
          }>;
      parsed?: unknown;
      refusal?: string;
    };
  }>;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usage?: Record<string, unknown>;
};

function extractStructuredText(payload: KieChatResponse) {
  const response = payload.data ?? payload;
  const message = response.choices?.[0]?.message;
  if (message?.parsed && typeof message.parsed === "object") {
    return JSON.stringify(message.parsed);
  }
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    const content = message.content
      .map((part) => {
        if (typeof part.text === "string") return part.text;
        if (part.text && typeof part.text.value === "string") {
          return part.text.value;
        }
        return part.content ?? "";
      })
      .join("")
      .trim();
    if (content) return content;
  }
  if (typeof response.output_text === "string") {
    return response.output_text.trim();
  }
  const outputText = response.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .join("")
    .trim();
  if (outputText) return outputText;
  return (
    response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function parseStructuredResult(outputText: string) {
  let normalized = outputText.trim();
  if (normalized.startsWith("```")) {
    normalized = normalized
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (typeof parsed === "string") return JSON.parse(parsed) as unknown;
    return parsed;
  } catch {
    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(normalized.slice(firstBrace, lastBrace + 1)) as unknown;
    }
    throw new Error("Kie AI returned text that was not valid structured JSON.");
  }
}

function normalizeStageResult(targetStage: 0 | 1 | 2 | 3 | 4, result: unknown) {
  if (
    (targetStage !== 2 && targetStage !== 3) ||
    !result ||
    typeof result !== "object" ||
    !Array.isArray((result as { assets?: unknown }).assets)
  ) {
    return result;
  }

  const assets = (result as { assets: unknown[] }).assets.map((asset) => {
    if (!asset || typeof asset !== "object") return asset;
    const {
      assetType,
      ...fields
    } = asset as Record<string, unknown> & { assetType?: unknown };
    return {
      ...fields,
      type: assetType,
    };
  });
  return { ...(result as Record<string, unknown>), assets };
}

function responseDiagnostic(payload: KieChatResponse) {
  const response = payload.data ?? payload;
  const message = response.choices?.[0]?.message;
  return {
    topLevelFields: Object.keys(payload).slice(0, 20),
    wrappedInData: Boolean(payload.data),
    responseFields: Object.keys(response).slice(0, 20),
    choicesCount: response.choices?.length ?? 0,
    finishReason:
      response.choices?.[0]?.finish_reason ??
      response.candidates?.[0]?.finishReason ??
      null,
    contentType: Array.isArray(message?.content)
      ? "array"
      : typeof message?.content,
    contentParts: Array.isArray(message?.content)
      ? message.content.map((part) => part.type ?? "unknown")
      : [],
    hasParsedObject: Boolean(message?.parsed),
    refusal: safeLogValue(message?.refusal) || null,
    providerCode: payload.code ?? null,
    providerMessage: safeLogValue(payload.msg) || null,
    usage: response.usage ?? null,
  };
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerationRequest;
  try {
    body = (await request.json()) as GenerationRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (
    body.targetStage !== 0 &&
    body.targetStage !== 1 &&
    body.targetStage !== 2 &&
    body.targetStage !== 3 &&
    body.targetStage !== 4
  ) {
    return NextResponse.json(
      { error: "This endpoint generates creative seeds and stages 1 through 4." },
      { status: 400 },
    );
  }

  const apiKey = await getProviderApiKey("kie");
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "missing_credential",
        provider: "kie",
        message: "Add a KIE AI Key before generating this stage.",
        diagnostic: {
          requestId,
          timestamp: new Date().toISOString(),
          phase: "credential",
          credential: {
            source: "CABUILD managed key store",
            configured: false,
            found: false,
          },
        },
      },
      { status: 401 },
    );
  }

  const targetStage = body.targetStage;
  const format = schemas[targetStage];
  const modelId =
    body.model && body.model in chatModels
      ? (body.model as ChatModelId)
      : "gemini-3-pro";
  const selectedModel = chatModels[modelId];
  const baseDiagnostic = {
    requestId,
    timestamp: new Date().toISOString(),
    phase: "structured_stage_generation",
    credential: {
      source: "CABUILD managed key store",
      found: true,
      fingerprint: "cabuild-managed",
      savedAt: null,
    },
    request: {
      targetStage,
      selectedModel: modelId,
      endpoint: selectedModel.endpoint,
      schemaName: format.name,
      snapshotFields: Object.keys(body.snapshot ?? {}),
    },
  };

  try {
    const kieResponse = await fetch(
      `https://api.kie.ai${selectedModel.endpoint}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: [
                {
                  type: "text",
                  text: "You are a senior episodic drama development producer. Follow the selected source exactly, make decisive creative choices, and return only the requested structured result.",
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: stagePrompt(targetStage, body.snapshot),
                },
              ],
            },
          ],
          stream: false,
          ...(selectedModel.reasoning
            ? { reasoning_effort: "medium" }
            : { include_thoughts: false }),
          response_format: {
            type: "json_schema",
            json_schema: {
              name: format.name,
              strict: true,
              schema: format.schema,
            },
          },
        }),
      },
    );

    const responseText = await kieResponse.text();
    let responseBody: KieChatResponse = {};
    try {
      responseBody = JSON.parse(responseText) as KieChatResponse;
    } catch {
      responseBody = {};
    }

    if (
      !kieResponse.ok ||
      (responseBody.code !== undefined &&
        Number(responseBody.code) !== 0 &&
        Number(responseBody.code) !== 200)
    ) {
      return NextResponse.json(
        {
          error: "provider_error",
          provider: "kie",
          message:
            safeLogValue(responseBody.msg, 240) ||
            safeProviderMessage(kieResponse.status),
          diagnostic: {
            ...baseDiagnostic,
            upstream: {
              httpStatus: kieResponse.status,
              response:
                responseDiagnostic(responseBody),
              unreadableResponse:
                Object.keys(responseBody).length === 0
                  ? safeLogValue(responseText)
                  : null,
            },
          },
        },
        { status: kieResponse.status >= 500 ? 502 : 400 },
      );
    }

    const outputText = extractStructuredText(responseBody);
    if (!outputText) {
      return NextResponse.json(
        {
          error: "empty_structured_output",
          provider: "kie",
          message:
            "Kie AI completed the request but returned no usable structured output.",
          diagnostic: {
            ...baseDiagnostic,
            upstream: {
              httpStatus: kieResponse.status,
              response: responseDiagnostic(responseBody),
            },
          },
        },
        { status: 502 },
      );
    }

    let result: unknown;
    try {
      result = parseStructuredResult(outputText);
    } catch (error) {
      return NextResponse.json(
        {
          error: "invalid_structured_output",
          provider: "kie",
          message:
            error instanceof Error
              ? error.message
              : "Kie AI returned invalid structured JSON.",
          diagnostic: {
            ...baseDiagnostic,
            upstream: {
              httpStatus: kieResponse.status,
              response: responseDiagnostic(responseBody),
              outputPreview: safeLogValue(outputText),
              outputLength: outputText.length,
            },
          },
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      provider: "Kie AI",
      model: `Kie AI · ${selectedModel.label}`,
      modelId,
      targetStage,
      result: normalizeStageResult(targetStage, result),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "generation_failed",
        provider: "kie",
        message:
          error instanceof Error
            ? error.message
            : "The production stage could not be generated with Kie AI.",
        diagnostic: {
          ...baseDiagnostic,
          networkError: safeLogValue(
            error instanceof Error ? error.message : "Unknown network error",
          ),
        },
      },
      { status: 502 },
    );
  }
}
