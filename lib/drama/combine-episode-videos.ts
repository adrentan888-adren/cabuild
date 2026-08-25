"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const origin = window.location.origin;
      await ffmpeg.load({
        classWorkerURL: `${origin}/ffmpeg/worker.js`,
        coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
        wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

export async function combineEpisodeVideos(
  urls: string[],
  onProgress?: (message: string) => void,
) {
  if (urls.length === 0) {
    throw new Error("Generate the episode clips before combining them.");
  }

  if (urls.length === 1) {
    onProgress?.("Preparing the completed clip as the episode video…");
    const proxiedUrl = `/api/drama/media-proxy?url=${encodeURIComponent(urls[0])}`;
    const response = await fetch(proxiedUrl, { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(payload?.error || "The completed clip could not be loaded.");
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("The completed clip returned no video data.");
    return { blob, url: URL.createObjectURL(blob) };
  }

  onProgress?.("Loading the browser video editor…");
  const ffmpeg = await getFfmpeg();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inputNames: string[] = [];
  const outputName = `episode-${runId}.mp4`;
  const listName = `episode-${runId}.txt`;

  try {
    for (let index = 0; index < urls.length; index += 1) {
      onProgress?.(`Loading clip ${index + 1} of ${urls.length}…`);
      const inputName = `clip-${runId}-${index}.mp4`;
      const proxiedUrl = `/api/drama/media-proxy?url=${encodeURIComponent(urls[index])}`;
      const response = await fetch(proxiedUrl, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          payload?.error || `Clip ${index + 1} could not be loaded for assembly.`,
        );
      }
      const inputData = new Uint8Array(await response.arrayBuffer());
      if (!inputData.byteLength) {
        throw new Error(`Clip ${index + 1} returned no video data.`);
      }
      await ffmpeg.writeFile(inputName, inputData);
      inputNames.push(inputName);
    }

    await ffmpeg.writeFile(
      listName,
      new TextEncoder().encode(
        inputNames.map((name) => `file '${name}'`).join("\n"),
      ),
    );

    onProgress?.("Combining clips in scene order…");
    let exitCode = await ffmpeg.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listName,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    if (exitCode !== 0) {
      onProgress?.("Normalising clip formats and finishing the episode…");
      exitCode = await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listName,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputName,
      ]);
    }
    if (exitCode !== 0) {
      throw new Error("FFmpeg could not combine these clip formats.");
    }

    const output = await ffmpeg.readFile(outputName);
    const bytes =
      typeof output === "string" ? new TextEncoder().encode(output) : output;
    const blob = new Blob([bytes as BlobPart], { type: "video/mp4" });
    return { blob, url: URL.createObjectURL(blob) };
  } finally {
    await Promise.allSettled([
      ...inputNames.map((name) => ffmpeg.deleteFile(name)),
      ffmpeg.deleteFile(listName),
      ffmpeg.deleteFile(outputName),
    ]);
  }
}
