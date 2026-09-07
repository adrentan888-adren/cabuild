import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getProviderApiKey } from "@/lib/apiKeyOverrides";
import { id, mutateDb, readDb } from "@/lib/store";
import type { GenerationAssetReference } from "@/lib/types";
import { finishDramaMediaTask, getDramaMediaResult, getDramaMediaTask, saveDramaMediaTask, type DramaMediaTask, type DramaMediaResult } from "@/lib/drama/media-tasks";

import { issueMediaTaskReceipt, recoverMediaTaskReceipt, requireMediaReceiptSecret } from "@/lib/drama/media-receipt";

export const runtime = "nodejs";
class MediaTaskPersistenceError extends Error {
  constructor(public task: DramaMediaTask, public recoveryReceipt: string) { super("Media task storage is temporarily unavailable."); }
}

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
  const task: DramaMediaTask = { taskId: args.taskId, workspaceId: args.credential.workspaceId,
    asset: {
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
    },
    publishItem: {
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
    },
  };
  const recoveryReceipt = issueMediaTaskReceipt(task);
  let savedTask: DramaMediaTask;
  try { savedTask = await saveDramaMediaTask(task); }
  catch { throw new MediaTaskPersistenceError(task, recoveryReceipt); }
  // The immutable ledger is authoritative even if the shared library projection
  // suffers another writer's update or is temporarily unavailable.
  await projectTask(savedTask).catch(() => console.warn("Drama media library synchronization deferred."));
  return { assetId: savedTask.asset.id, publishItemId: savedTask.publishItem.id, recoveryReceipt };
}

async function projectTask(task: DramaMediaTask, result?: DramaMediaResult) {
  await mutateDb((db) => {
    let asset = db.assets.find(item => item.id === task.asset.id && item.workspaceId === task.workspaceId);
    const firstProjection = !asset;
    if (!asset) { asset = structuredClone(task.asset); db.assets.push(asset); }
    let publishItem = db.publishQueue.find(item => item.id === task.publishItem.id && item.workspaceId === task.workspaceId);
    if (!publishItem) { publishItem = structuredClone(task.publishItem); db.publishQueue.push(publishItem); }
    const wasReady = asset.status === "ready";
    if (result) {
      asset.status = result.state === "success" ? "ready" : "failed";
      asset.progress = result.progress;
      if (result.resultUrls[0]) { asset.assetUrl = result.resultUrls[0]; publishItem.assetUrl = result.resultUrls[0]; }
      if (result.state === "fail") { asset.error = result.message; publishItem.error = result.message; }
      // Do not undo a publish/schedule action performed from My Contents.
      if (publishItem.status === "generating" || publishItem.status === "failed") publishItem.status = result.state === "success" ? "done" : "failed";
    }
    if (firstProjection || (result?.state === "success" && !wasReady)) db.activity.push({
      id: id("act"),
      workspaceId: task.workspaceId,
      message: result?.state === "success" ? `Drama Studio generation completed: "${asset.title}".` : `Queued Drama Studio generation: "${asset.title}".`,
      createdAt: new Date().toISOString(),
    });
  });
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
  try { return await createMedia(request); }
  catch { return NextResponse.json({ error: "storage_unavailable", message: "Media generation is temporarily unavailable. Please try again when saved account information is available." }, { status: 503 }); }
}
async function createMedia(request: Request) {
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

  if (!body || (body.kind !== "image" && body.kind !== "video")) {
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

  // Validate recovery capability before submitting a potentially billable task.
  requireMediaReceiptSecret();
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

    let persisted: { assetId: string; publishItemId: string; recoveryReceipt: string };
    try { persisted = await persistTask({
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
    }); } catch (error) {
      return NextResponse.json({ error: "storage_unavailable", taskId: payload.data.taskId,
        ...(error instanceof MediaTaskPersistenceError ? { accepted: true, storagePending: true, state: "waiting",
          assetId: error.task.asset.id, publishItemId: error.task.publishItem.id, recoveryReceipt: error.recoveryReceipt,
          model: "Kie AI · " + modelLabel, modelId: body.model,
        } : {}),
        message: "Kie AI accepted this media task. Saving its recovery information is temporarily delayed; automatic checks will recover the existing task without generating it again.",
        diagnostic: { ...requestDiagnostic, task: { taskId: payload.data.taskId }, phase: "persist_task" },
      }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      provider: "Kie AI",
      model: "Kie AI · " + modelLabel,
      modelId: body.model,
      taskId: payload.data.taskId,
      assetId: persisted.assetId,
      publishItemId: persisted.publishItemId,
      recoveryReceipt: persisted.recoveryReceipt,
      state: "waiting",
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
  try { return await checkMedia(request); }
  catch { return NextResponse.json({ error: "storage_unavailable", message: "Saved media task information is temporarily unavailable. Your task has not been restarted." }, { status: 503 }); }
}
async function checkMedia(request: Request) {
  const requestId = randomUUID();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }
  let task: DramaMediaTask | null;
  let cached: DramaMediaResult | null;
  try {
    task = await getDramaMediaTask(user.workspaceId, taskId);
    if (!task) {
      const db = await readDb();
      const asset = db.assets.find(item => item.workspaceId === user.workspaceId && item.provider === "kie" && item.providerTaskId === taskId);
      const publish = db.publishQueue.find(item => item.workspaceId === user.workspaceId && item.provider === "kie" && item.providerRequestId === taskId);
      // Only surviving server-owned records can establish legacy ownership.
      if (asset || publish) {
        const recoveredAsset = asset || {
          id: publish!.assetId, workspaceId: user.workspaceId, briefId: String(publish!.generationSettings?.dramaRecordId || "drama-studio"),
          title: publish!.title, type: publish!.generationType === "video" ? "video" as const : "image" as const,
          status: "rendering" as const, progress: 10, createdAt: publish!.createdAt || publish!.scheduledAt,
          provider: "kie" as const, providerTaskId: taskId, generationModel: publish!.generationModel,
          generationSettings: publish!.generationSettings, prompt: publish!.prompt, assetReferences: publish!.assetReferences,
        };
        task = await saveDramaMediaTask({ taskId, workspaceId: user.workspaceId, asset: recoveredAsset, publishItem: publish || {
          id: id("pub"), workspaceId: user.workspaceId, assetId: recoveredAsset.id, title: recoveredAsset.title,
          platform: "TikTok", scheduledAt: recoveredAsset.createdAt, createdAt: recoveredAsset.createdAt,
          status: "generating", provider: "kie", providerRequestId: taskId, generationModel: recoveredAsset.generationModel,
          generationType: recoveredAsset.type === "video" ? "video" : "image", generationSettings: recoveredAsset.generationSettings,
          prompt: recoveredAsset.prompt, assetReferences: recoveredAsset.assetReferences,
        } });
      }
    }
    if (!task) {
      const recovered = recoverMediaTaskReceipt(request.headers.get("X-Drama-Task-Receipt"), user.workspaceId, taskId);
      if (recovered) task = await saveDramaMediaTask(recovered);
    }
    if (!task) return NextResponse.json({ error: "task_not_found", message: "Drama media task was not found in this workspace. Its saved ownership record is unavailable; automatic checks have stopped." }, { status: 404 });
    cached = await getDramaMediaResult(user.workspaceId, taskId);
  } catch {
    return NextResponse.json({ error: "storage_unavailable", message: "Saved media task information is temporarily unavailable. Your task has not been restarted." }, { status: 503 });
  }
  if (cached) {
    await projectTask(task, cached).catch(() => console.warn("Drama media library synchronization deferred."));
    return NextResponse.json({ ok: true, assetId: task.asset.id, ...cached });
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
    if (!response.ok || Number(payload.code) !== 200 || !payload.data || (payload.data.taskId && payload.data.taskId !== taskId)) {
      return NextResponse.json(
        {
          error: "provider_error",
          message: providerError(response.status, payload.msg),
          diagnostic: statusDiagnostic,
        },
        // Upstream failures do not invalidate this already-owned task. Preserve
        // a retryable response so polling can recover without another creation.
        { status: response.status === 429 || Number(payload.code) === 429 ? 429 : 502 },
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

    // Some provider completions expose their download URL a little later. This
    // remains quiet progress, not a failed task or an immutable empty result.
    const providerState = payload.data.state === "success" && !resultUrls.length ? "generating" : payload.data.state || "waiting";
    const isReady = providerState === "success";
    const isFailed = providerState === "fail";
    const progress = isReady
      ? 100
      : payload.data.state === "success" ? 99 : Math.max(10, Math.min(99, payload.data.progress ?? 10));
    let finalResult: DramaMediaResult | null;
    try {
      finalResult = isReady || isFailed ? await finishDramaMediaTask(user.workspaceId, taskId, {
        state: isReady ? "success" : "fail", progress, resultUrls,
        message: isFailed ? safeLogValue(payload.data.failMsg, 5000) || "Kie AI generation failed." : "",
        failCode: isFailed ? safeLogValue(payload.data.failCode) : "", model: payload.data.model ?? "",
      }) : await getDramaMediaResult(user.workspaceId, taskId);
    } catch {
      return NextResponse.json({ error: "storage_unavailable", message: "Media progress could not be saved safely. Your task has not been restarted." }, { status: 503 });
    }
    await projectTask(task, finalResult || undefined).catch(() => console.warn("Drama media library synchronization deferred."));
    if (finalResult) return NextResponse.json({ ok: true, assetId: task.asset.id, ...finalResult,
      diagnostic: finalResult.state === "fail" ? statusDiagnostic : undefined });

    return NextResponse.json({
      ok: true,
      assetId: task.asset.id,
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
