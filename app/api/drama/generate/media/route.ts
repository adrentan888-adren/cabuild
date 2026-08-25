import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProviderApiKey } from "@/lib/apiKeyOverrides";
import { id, mutateDb, readDb } from "@/lib/store";
import type { GenerationAssetReference } from "@/lib/types";

export const runtime = "nodejs";

type MediaRequest = {
  kind?: unknown;
  model?: unknown;
  prompt?: unknown;
  title?: unknown;
  recordId?: unknown;
  itemId?: unknown;
  duration?: unknown;
  aspectRatio?: unknown;
  mode?: unknown;
  sound?: unknown;
  references?: unknown;
};

const imageModels = {
  "gpt-image-2": {
    label: "GPT Image 2",
    apiModel: "gpt-image-2-text-to-image",
  },
  "seedream-4.5": {
    label: "Seedream 4.5",
    apiModel: "seedream/4.5-text-to-image",
  },
  "qwen2-image": {
    label: "Qwen2 Image",
    apiModel: "qwen2/text-to-image",
  },
} as const;

const videoModels = {
  "kling-3.0": {
    label: "Kling 3.0",
    apiModel: "kling-3.0/video",
  },
  "kling-v3-turbo": {
    label: "Kling V3 Turbo · 720p",
    apiModel: "kling/v3-turbo-text-to-video",
  },
  "seedance-2.0": {
    label: "Seedance 2.0 · 720p",
    apiModel: "bytedance/seedance-2",
  },
} as const;

type ImageModelId = keyof typeof imageModels;
type VideoModelId = keyof typeof videoModels;

function normalizedAspectRatio(value?: string) {
  return value === "9:16" || value === "1:1" ? value : "16:9";
}

async function resolveReferences(
  value: unknown,
  workspaceId: string,
): Promise<GenerationAssetReference[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("Reference selection must be an array.");
  }
  const ids = [
    ...new Set(
      value.map((item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string"
          ? String((item as Record<string, unknown>).id)
          : "",
      ),
    ),
  ].filter(Boolean);
  if (ids.length !== value.length || ids.length > 12) {
    throw new Error("Reference selection is invalid.");
  }
  const db = await readDb();
  const persona = db.personaProfiles.find(
    (item) => item.workspaceId === workspaceId,
  );
  const selected = ids.map((assetId) =>
    persona?.mediaAssets?.find((asset) => asset.id === assetId),
  );
  if (selected.some((asset) => !asset)) {
    throw new Error(
      "One or more reference assets do not belong to this workspace.",
    );
  }
  return selected.map((asset) => ({
    role: asset!.role,
    fileName: asset!.fileName,
    url: asset!.url,
    storageKey: asset!.storageKey,
    contentType: asset!.contentType,
  }));
}
function referenceUrls(
  references: GenerationAssetReference[],
  type: "image" | "audio",
) {
  return references
    .filter((item) => {
      const contentType = item.contentType?.toLowerCase() || "";
      return type === "audio"
        ? contentType.startsWith("audio/") || item.role === "audio"
        : !contentType.startsWith("audio/");
    })
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));
}

async function persistTask(args: {
  credential: NonNullable<Awaited<ReturnType<typeof getKieCredential>>>;
  taskId: string;
  requestBody: MediaRequest;
  kind: "image" | "video";
  modelId: ImageModelId | VideoModelId;
  modelLabel: string;
  prompt: string;
  aspectRatio: string;
  duration?: number;
  references: GenerationAssetReference[];
}) {
  const now = new Date().toISOString();
  const assetId = id("ast");
  const publishItemId = id("pub");
  const title =
    typeof args.requestBody.title === "string" &&
    args.requestBody.title.trim()
      ? args.requestBody.title.trim().slice(0, 120)
      : `Drama ${args.kind}`;
  const recordId =
    typeof args.requestBody.recordId === "string"
      ? args.requestBody.recordId
      : "";
  const itemId =
    typeof args.requestBody.itemId === "string"
      ? args.requestBody.itemId
      : "";
  const generationSettings = {
    aspectRatio: args.aspectRatio,
    duration: args.duration,
    source: "drama-studio",
    dramaRecordId: recordId,
    dramaItemId: itemId,
  };
  await mutateDb((db) => {
    db.assets.push({
      id: assetId,
      workspaceId: args.credential.workspaceId,
      briefId: recordId || "drama-studio",
      title,
      type: args.kind,
      status: "rendering",
      progress: 10,
      createdAt: now,
      provider: "kie",
      providerTaskId: args.taskId,
      generationModel: args.modelId,
      generationSettings,
      prompt: args.prompt,
      assetReferences: args.references,
    });
    db.publishQueue.push({
      id: publishItemId,
      workspaceId: args.credential.workspaceId,
      assetId,
      title,
      platform: "TikTok",
      scheduledAt: now,
      status: "generating",
      provider: "kie",
      providerRequestId: args.taskId,
      generationModel: args.modelId,
      generationType: args.kind,
      generationSettings,
      duration: args.duration,
      prompt: args.prompt,
      assetReferences: args.references,
      createdAt: now,
    });
    db.activity.push({
      id: id("act"),
      workspaceId: args.credential.workspaceId,
      message: `Queued ${args.modelLabel} generation from Drama Studio: "${title}".`,
      createdAt: now,
    });
  });
  return { assetId, publishItemId };
}

async function getKieCredential() {
  const user = await currentUser();
  if (!user) return null;
  const apiKey = await getProviderApiKey("kie");
  if (!apiKey) return null;
  return {
    apiKey,
    workspaceId: user.workspaceId,
    userId: user.id,
    fingerprint: "cabuild-managed",
    savedAt: null,
  };
}

function safeLogValue(value?: string, limit = 500) {
  return (
    value
      ?.replace(/bearer\s+\S+/gi, "credential")
      .replace(/key\s*[:=]\s*\S+/gi, "key")
      .trim()
      .slice(0, limit) ?? ""
  );
}

function providerError(status: number, providerMessage?: string) {
  if (status === 401 || status === 403) {
    return "Kie AI rejected this key. Update the saved KIE AI Key and try again.";
  }
  if (status === 429) {
    return "Kie AI is rate-limiting this workspace or has insufficient credits.";
  }
  const safeDetail = safeLogValue(providerMessage, 240);
  if (safeDetail && safeDetail.toLowerCase() !== "success") {
    return `Kie AI rejected this task: ${safeDetail}`;
  }
  return "Kie AI could not create this media task.";
}

function extractResultUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      if (/^https?:\/\//i.test(item)) urls.add(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === "object") {
      Object.values(item as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return [...urls];
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: MediaRequest;
  try {
    body = (await request.json()) as MediaRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (body.kind !== "image" && body.kind !== "video") {
    return NextResponse.json(
      { error: 'kind must be exactly "image" or "video".' },
      { status: 400 },
    );
  }
  const isVideo = body.kind === "video";
  if (typeof body.model !== "string") {
    return NextResponse.json(
      { error: "A supported model is required." },
      { status: 400 },
    );
  }
  if (
    (!isVideo && !(body.model in imageModels)) ||
    (isVideo && !(body.model in videoModels))
  ) {
    return NextResponse.json(
      { error: "Unsupported " + body.kind + " model." },
      { status: 400 },
    );
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  }

  const imageModelId = body.model as ImageModelId;
  const videoModelId = body.model as VideoModelId;
  let references: GenerationAssetReference[];
  try {
    references = await resolveReferences(body.references, user.workspaceId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid references." },
      { status: 400 },
    );
  }
  if (
    !isVideo &&
    references.some(
      (reference) =>
        reference.role === "audio" ||
        reference.contentType?.toLowerCase().startsWith("audio/"),
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Audio references can only be used with Seedance 2.0 video generation.",
      },
      { status: 400 },
    );
  }
  if (
    references.length > 0 &&
    ((!isVideo && imageModelId === "qwen2-image") ||
      (isVideo && videoModelId !== "seedance-2.0"))
  ) {
    return NextResponse.json(
      {
        error:
          body.model +
          " does not support Drama Studio reference assets. Select GPT Image 2 or Seedream 4.5 for images, or Seedance 2.0 for video.",
      },
      { status: 400 },
    );
  }

  const apiKey = await getProviderApiKey("kie");
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "missing_credential",
        provider: "kie",
        message: "Add a KIE AI Key before generating media.",
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
  const credential = {
    apiKey,
    workspaceId: user.workspaceId,
    userId: user.id,
    fingerprint: "cabuild-managed",
    savedAt: null,
  };

  const originalPrompt = body.prompt.trim();
  const videoPromptLimit = 2400;
  const prompt =
    isVideo && originalPrompt.length > videoPromptLimit
      ? originalPrompt.slice(0, videoPromptLimit - 1).trimEnd() + "…"
      : originalPrompt;
  const aspectRatio = normalizedAspectRatio(
    typeof body.aspectRatio === "string" ? body.aspectRatio : undefined,
  );
  const requestedDuration =
    typeof body.duration === "number" && Number.isFinite(body.duration)
      ? body.duration
      : 5;
  const durationNumber = Math.max(3, Math.min(15, requestedDuration));
  const duration = String(durationNumber);
  const imageSeed = isVideo ? null : randomInt(1, 2_147_483_647);
  const imageReferences = referenceUrls(references, "image");
  const audioReferences = referenceUrls(references, "audio");

  let requestBody: { model: string; input: Record<string, unknown> };
  let modelLabel: string;

  if (isVideo) {
    const selected = videoModels[videoModelId];
    modelLabel = selected.label;
    if (videoModelId === "kling-v3-turbo") {
      requestBody = {
        model: selected.apiModel,
        input: {
          prompt,
          duration,
          aspect_ratio: aspectRatio,
          resolution: "720p",
        },
      };
    } else if (videoModelId === "seedance-2.0") {
      requestBody = {
        model: selected.apiModel,
        input: {
          prompt,
          return_last_frame: false,
          generate_audio: typeof body.sound === "boolean" ? body.sound : true,
          resolution: "720p",
          aspect_ratio: aspectRatio,
          duration: durationNumber,
          web_search: false,
          ...(imageReferences.length
            ? { reference_image_urls: imageReferences.slice(0, 10) }
            : {}),
          ...(audioReferences.length
            ? { reference_audio_urls: audioReferences.slice(0, 3) }
            : {}),
        },
      };
    } else {
      const mode =
        body.mode === "std" || body.mode === "pro" || body.mode === "4K"
          ? body.mode
          : "pro";
      requestBody = {
        model: selected.apiModel,
        input: {
          prompt,
          sound: typeof body.sound === "boolean" ? body.sound : true,
          duration,
          aspect_ratio: aspectRatio,
          mode,
          multi_shots: false,
        },
      };
    }
  } else {
    const selected = imageModels[imageModelId];
    modelLabel = selected.label;
    if (imageModelId === "seedream-4.5") {
      requestBody = imageReferences.length
        ? {
            model: "seedream/4.5-edit",
            input: {
              prompt,
              image_urls: imageReferences.slice(0, 10),
              aspect_ratio: aspectRatio,
              quality: "basic",
              nsfw_checker: false,
            },
          }
        : {
            model: selected.apiModel,
            input: {
              prompt,
              aspect_ratio: aspectRatio,
              quality: "basic",
              nsfw_checker: false,
            },
          };
    } else if (imageModelId === "qwen2-image") {
      requestBody = {
        model: selected.apiModel,
        input: {
          prompt,
          image_size: aspectRatio,
          seed: imageSeed,
          output_format: "png",
        },
      };
    } else {
      requestBody = imageReferences.length
        ? {
            model: "gpt-image-2-image-to-image",
            input: {
              prompt,
              input_urls: imageReferences.slice(0, 10),
              aspect_ratio: aspectRatio,
            },
          }
        : {
            model: selected.apiModel,
            input: {
              prompt,
              aspect_ratio: "auto",
            },
          };
    }
  }

  const requestDiagnostic = {
    requestId,
    timestamp: new Date().toISOString(),
    phase: "create_task",
    credential: {
      source: "CABUILD managed key store",
      found: true,
      fingerprint: credential.fingerprint,
      savedAt: credential.savedAt,
    },
    request: {
      kind: body.kind,
      selectedModel: body.model,
      apiModel: requestBody.model,
      aspectRatio,
      originalPromptLength: originalPrompt.length,
      promptLength: prompt.length,
      promptLimit: isVideo ? videoPromptLimit : null,
      promptTruncated: prompt.length !== originalPrompt.length,
      imageSeed,
      referenceCount: references.length,
      inputFields: Object.keys(requestBody.input),
    },
  };

  try {
    const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + credential.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const responseText = await response.text();
    let payload: {
      code?: number | string;
      msg?: string;
      data?: { taskId?: string };
    } = {};
    try {
      payload = JSON.parse(responseText) as typeof payload;
    } catch {
      payload = {};
    }
    if (
      !response.ok ||
      Number(payload.code) !== 200 ||
      !payload.data?.taskId
    ) {
      return NextResponse.json(
        {
          error: "provider_error",
          provider: "kie",
          message: providerError(response.status, payload.msg),
          diagnostic: {
            ...requestDiagnostic,
            upstream: {
              httpStatus: response.status,
              code: payload.code ?? null,
              message:
                safeLogValue(payload.msg) ||
                safeLogValue(responseText) ||
                "Kie AI returned an unreadable response.",
              taskId: payload.data?.taskId ?? null,
            },
          },
        },
        { status: response.status >= 500 ? 502 : 400 },
      );
    }

    const persisted = await persistTask({
      credential,
      taskId: payload.data.taskId,
      requestBody: body,
      kind: body.kind,
      modelId: isVideo ? videoModelId : imageModelId,
      modelLabel,
      prompt,
      aspectRatio,
      duration: isVideo ? durationNumber : undefined,
      references,
    });
    return NextResponse.json({
      ok: true,
      provider: "Kie AI",
      model: "Kie AI · " + modelLabel,
      modelId: body.model,
      taskId: payload.data.taskId,
      assetId: persisted.assetId,
      publishItemId: persisted.publishItemId,
      state: "waiting",
      diagnostic: {
        ...requestDiagnostic,
        upstream: {
          httpStatus: response.status,
          code: payload.code,
          message: safeLogValue(payload.msg),
          taskId: payload.data.taskId,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "generation_failed",
        provider: "kie",
        message: "The Kie AI media task could not be created or persisted.",
        diagnostic: {
          ...requestDiagnostic,
          networkError: safeLogValue(
            error instanceof Error ? error.message : "Unknown network error",
          ),
        },
      },
      { status: 502 },
    );
  }
}
export async function GET(request: Request) {
  const requestId = randomUUID();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }
  const db = await readDb();
  const ownedAsset = db.assets.find(
    (asset) =>
      asset.workspaceId === user.workspaceId &&
      asset.provider === "kie" &&
      asset.providerTaskId === taskId,
  );
  if (!ownedAsset) {
    return NextResponse.json(
      { error: "Drama media task was not found in this workspace." },
      { status: 404 },
    );
  }

  const apiKey = await getProviderApiKey("kie");
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "missing_credential",
        provider: "kie",
        message: "Add a KIE AI Key before checking media.",
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
  const credential = {
    apiKey,
    workspaceId: user.workspaceId,
    userId: user.id,
    fingerprint: "cabuild-managed",
    savedAt: null,
  };
  try {
    const response = await fetch(
      `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${credential.apiKey}` } },
    );
    const responseText = await response.text();
    let payload: {
      code?: number | string;
      msg?: string;
      data?: {
        taskId?: string;
        model?: string;
        state?: string;
        progress?: number;
        resultJson?: string;
        failCode?: string;
        failMsg?: string;
      };
    } = {};
    try {
      payload = JSON.parse(responseText) as typeof payload;
    } catch {
      payload = {};
    }
    const statusDiagnostic = {
      requestId,
      timestamp: new Date().toISOString(),
      phase: "task_status",
      credential: {
        source: "CABUILD managed key store",
        found: true,
        fingerprint: credential.fingerprint,
        savedAt: credential.savedAt,
      },
      task: {
        requestedTaskId: taskId,
        returnedTaskId: payload.data?.taskId ?? null,
        model: payload.data?.model ?? null,
        state: payload.data?.state ?? null,
        progress: payload.data?.progress ?? null,
        failCode: safeLogValue(payload.data?.failCode) || null,
        failMessage: safeLogValue(payload.data?.failMsg) || null,
      },
      upstream: {
        httpStatus: response.status,
        code: payload.code ?? null,
        message:
          safeLogValue(payload.msg) ||
          (!payload.data ? safeLogValue(responseText) : ""),
      },
    };
    if (!response.ok || !payload.data) {
      return NextResponse.json(
        {
          error: "provider_error",
          message: providerError(response.status, payload.msg),
          diagnostic: statusDiagnostic,
        },
        { status: response.status >= 500 ? 502 : 400 },
      );
    }

    let resultUrls: string[] = [];
    if (payload.data.resultJson) {
      try {
        const result = JSON.parse(payload.data.resultJson) as unknown;
        resultUrls = extractResultUrls(result);
      } catch {
        resultUrls = [];
      }
    }

    const providerState = payload.data.state || "waiting";
    const isReady = providerState === "success";
    const isFailed = providerState === "fail";
    const progress = isReady
      ? 100
      : Math.max(10, Math.min(99, payload.data.progress ?? 10));
    const primaryUrl = resultUrls[0];
    await mutateDb((nextDb) => {
      const asset = nextDb.assets.find(
        (item) =>
          item.id === ownedAsset.id &&
          item.workspaceId === credential.workspaceId,
      );
      if (!asset) return;
      const wasReady = asset.status === "ready";
      asset.status = isReady ? "ready" : isFailed ? "failed" : "rendering";
      asset.progress = progress;
      if (primaryUrl) asset.assetUrl = primaryUrl;
      if (isFailed) {
        asset.error =
          safeLogValue(payload.data?.failMsg) || "Kie AI generation failed.";
      }
      const publishItem = nextDb.publishQueue.find(
        (item) =>
          item.assetId === asset.id &&
          item.workspaceId === credential.workspaceId,
      );
      if (publishItem) {
        publishItem.status = isReady
          ? "done"
          : isFailed
            ? "failed"
            : "generating";
        if (primaryUrl) publishItem.assetUrl = primaryUrl;
        if (isFailed) publishItem.error = asset.error;
      }
      if (isReady && !wasReady) {
        nextDb.activity.push({
          id: id("act"),
          workspaceId: credential.workspaceId,
          message: 'Drama Studio generation completed: "' + asset.title + '".',
          createdAt: new Date().toISOString(),
        });
      }
    });

    return NextResponse.json({
      ok: true,
      assetId: ownedAsset.id,
      state: providerState,
      progress,
      resultUrls,
      message: payload.data.failMsg ?? "",
      failCode: payload.data.failCode ?? "",
      model: payload.data.model ?? "",
      diagnostic: isFailed ? statusDiagnostic : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "status_failed",
        message: "Could not check the Kie AI task.",
        diagnostic: {
          requestId,
          timestamp: new Date().toISOString(),
          phase: "task_status",
          credential: {
            source: "CABUILD managed key store",
            found: true,
            fingerprint: credential.fingerprint,
            savedAt: credential.savedAt,
          },
          task: { requestedTaskId: taskId },
          networkError: safeLogValue(
            error instanceof Error ? error.message : "Unknown network error",
          ),
        },
      },
      { status: 502 },
    );
  }
}
