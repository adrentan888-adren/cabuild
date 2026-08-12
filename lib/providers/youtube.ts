import { getProviderApiKey } from "@/lib/apiKeyOverrides";
import type { Platform } from "@/lib/types";

type YoutubeSnippet = {
  title?: string;
  description?: string;
  publishedAt?: string;
  channelTitle?: string;
  thumbnails?: Record<string, { url?: string; width?: number }>;
};

type YoutubeSearchResponse = {
  nextPageToken?: string;
  items?: Array<{
    id?: { videoId?: string };
    snippet?: YoutubeSnippet;
  }>;
  error?: { message?: string };
};

type YoutubeVideosResponse = {
  items?: Array<{
    id?: string;
    snippet?: YoutubeSnippet;
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
    status?: { embeddable?: boolean; privacyStatus?: string };
  }>;
  error?: { message?: string };
};

export type YoutubeResearchItem = {
  sourceUrl: string;
  platform: Platform;
  title: string;
  description: string;
  thumbnailUrl: string;
  mediaUrl: string;
  mediaType: "video";
  duration?: number;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string;
};

type YoutubeSearchOptions = {
  uploadDate?: string;
  contentType?: string;
  minViews?: number;
  maxResults?: number;
  regionCode?: string;
};

const apiBase = "https://www.googleapis.com/youtube/v3";

function publishedAfter(uploadDate = "") {
  const now = new Date();
  if (uploadDate === "today") now.setUTCHours(0, 0, 0, 0);
  else if (uploadDate === "this-week") now.setUTCDate(now.getUTCDate() - 7);
  else if (uploadDate === "this-month") now.setUTCMonth(now.getUTCMonth() - 1);
  else if (uploadDate === "this-year") now.setUTCFullYear(now.getUTCFullYear() - 1);
  else return "";
  return now.toISOString();
}

export function parseYoutubeDuration(value = "") {
  const match = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
}

function thumbnailUrl(thumbnails?: Record<string, { url?: string; width?: number }>) {
  return Object.values(thumbnails || {})
    .filter((item) => item.url)
    .sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0]?.url || "";
}

function n(value?: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesRequestedType(duration: number | undefined, contentType = "") {
  if (!contentType || contentType === "video") return true;
  if (contentType === "short-video") return typeof duration === "number" && duration <= 180;
  if (contentType === "long-video") return typeof duration === "number" && duration > 180;
  return true;
}

async function youtubeGet<T extends { error?: { message?: string } }>(path: string, params: Record<string, string>) {
  const key = await getProviderApiKey("youtube");
  if (!key) throw new Error("YOUTUBE_API_KEY is not configured.");
  const query = new URLSearchParams({ ...params, key });
  const response = await fetch(`${apiBase}/${path}?${query.toString()}`, { cache: "no-store" });
  const data = await response.json() as T;
  if (!response.ok) throw new Error(`YouTube Data API failed with HTTP ${response.status}: ${data.error?.message || "Unknown error"}`);
  return data;
}

export async function searchYoutubeVideos(keywords: string, options: YoutubeSearchOptions = {}) {
  const maxResults = Math.min(50, Math.max(1, options.maxResults || 50));
  const after = publishedAfter(options.uploadDate);
  const search = await youtubeGet<YoutubeSearchResponse>("search", {
    part: "snippet",
    type: "video",
    q: keywords.trim(),
    maxResults: String(maxResults),
    order: "relevance",
    regionCode: options.regionCode || "MY",
    safeSearch: "moderate",
    videoEmbeddable: "true",
    ...(after ? { publishedAfter: after } : {})
  });
  const ids = (search.items || []).map((item) => item.id?.videoId || "").filter(Boolean);
  if (!ids.length) return { items: [] as YoutubeResearchItem[], quota: { searchCalls: 1, videoListCalls: 0 } };

  const videos = await youtubeGet<YoutubeVideosResponse>("videos", {
    part: "snippet,statistics,contentDetails,status",
    id: ids.join(","),
    maxResults: String(ids.length)
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  const items = (videos.items || [])
    .filter((item) => item.id && item.status?.privacyStatus === "public" && item.status?.embeddable !== false)
    .map((item): YoutubeResearchItem => {
      const duration = parseYoutubeDuration(item.contentDetails?.duration);
      const videoId = item.id || "";
      return {
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        platform: "YouTube",
        title: item.snippet?.title || "YouTube video",
        description: item.snippet?.description || "",
        thumbnailUrl: thumbnailUrl(item.snippet?.thumbnails),
        mediaUrl: `https://www.youtube.com/embed/${videoId}`,
        mediaType: "video",
        duration,
        views: n(item.statistics?.viewCount),
        likes: n(item.statistics?.likeCount),
        comments: n(item.statistics?.commentCount),
        publishedAt: item.snippet?.publishedAt || new Date().toISOString()
      };
    })
    .filter((item) => item.views >= Math.max(0, options.minViews || 0))
    .filter((item) => matchesRequestedType(item.duration, options.contentType))
    .sort((a, b) => (order.get(a.sourceUrl.split("=").pop() || "") || 0) - (order.get(b.sourceUrl.split("=").pop() || "") || 0));
  return { items, quota: { searchCalls: 1, videoListCalls: 1 } };
}

export async function checkYoutubeHealth() {
  return { configured: Boolean(await getProviderApiKey("youtube")), provider: "YouTube Data API v3" };
}
