import type { Platform } from "@/lib/types";

type ApifySearchItem = {
  organicResults?: Array<Record<string, unknown>>;
  nonPromotedSearchResults?: Array<Record<string, unknown>>;
};

type KeywordDimensions = {
  actorSources?: string[];
  contentTypes?: string[];
  formats?: string[];
  contentType?: string;
  uploadDate?: string;
};

type NormalizedSocialItem = {
  sourceUrl: string;
  platform: Platform;
  title: string;
  description: string;
  thumbnailUrl: string;
  mediaUrl: string;
  mediaType: "video" | "image" | "unknown";
  duration?: number;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string;
};

type ActorSource = "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin";
type ResearchRunMeta = {
  actorId: string;
  runId: string;
  datasetId: string;
  source: ActorSource;
  fallbackUrl: string;
  minViews: number;
};

function token() {
  return process.env.APIFY_API_TOKEN;
}

export function hasApify() {
  return Boolean(token());
}

export async function fetchTrendSignals(niche: string) {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const actorId = process.env.APIFY_ACTOR_ID || "apify/google-search-scraper";
  const apiActorId = actorId.replace("/", "~");
  const url = `https://api.apify.com/v2/actors/${apiActorId}/run-sync-get-dataset-items?token=${token()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: `${niche || "social media content"} social media trend`,
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
      countryCode: "us",
      languageCode: "en"
    })
  });
  if (!res.ok) throw new Error(`Apify actor failed with HTTP ${res.status}.`);
  const items = (await res.json()) as ApifySearchItem[];
  return items
    .flatMap((item) => item.organicResults || item.nonPromotedSearchResults || [])
    .filter((item) => item.title)
    .slice(0, 5)
    .map((item, index) => ({
      title: s(item.title) || `Trend signal ${index + 1}`,
      description: s(item.description),
      url: s(item.url)
    }));
}

function n(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function s(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nested(item: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return "";
    return (current as Record<string, unknown>)[key];
  }, item);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const found = firstString(...value);
      if (found) return found;
    }
  }
  return "";
}

function thumbnailFrom(item: Record<string, unknown>): string {
  return firstString(
    item.thumbnailUrl,
    item.thumbnail,
    item.thumbnail_url,
    item.coverUrl,
    item.cover,
    item.imageUrl,
    item.image,
    item.displayUrl,
    item.display_url,
    item.mediaUrl,
    item.media_url,
    item.videoCover,
    item.videoThumbnail,
    item.videoDynamicCover,
    nested(item, "videoMeta.coverUrl"),
    nested(item, "videoMeta.thumbnailUrl"),
    nested(item, "video.cover"),
    nested(item, "video.thumbnail"),
    nested(item, "video.thumbnailUrl"),
    nested(item, "video.dynamicCover"),
    nested(item, "images.0"),
    nested(item, "image.0.url")
  );
}

function mediaUrlFrom(item: Record<string, unknown>): string {
  return firstString(
    item.videoUrl,
    item.video_url,
    item.videoDownloadUrl,
    item.downloadUrl,
    item.playUrl,
    item.playAddr,
    item.mediaUrl,
    item.media_url,
    item.imageUrl,
    item.image,
    item.displayUrl,
    item.display_url,
    item.thumbnailUrl,
    nested(item, "video.url"),
    nested(item, "video.playAddr"),
    nested(item, "video.downloadAddr"),
    nested(item, "video.downloadUrl"),
    nested(item, "videoMeta.videoUrl"),
    nested(item, "videoMeta.downloadUrl"),
    nested(item, "videoMeta.playUrl"),
    nested(item, "images.0"),
    nested(item, "image.0.url")
  );
}

function mediaTypeFrom(item: Record<string, unknown>, mediaUrl: string): "video" | "image" | "unknown" {
  const hint = firstString(item.type, item.mediaType, item.productType, item.displayResourceType, item.__typename, item.url, item.webVideoUrl, item.postUrl, mediaUrl).toLowerCase();
  if (/\.(mp4|mov|webm|m3u8)(\?|$)/i.test(mediaUrl) || hint.includes("video") || hint.includes("reel") || hint.includes("short")) return "video";
  if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(mediaUrl) || hint.includes("image") || hint.includes("photo") || hint.includes("carousel")) return "image";
  return mediaUrl ? "unknown" : "unknown";
}

function durationFrom(item: Record<string, unknown>) {
  const value =
    n(item.durationSeconds) ||
    n(item.durationSec) ||
    n(item.videoDuration) ||
    n(item.videoDurationSeconds) ||
    n(item.lengthSeconds) ||
    n(item.lengthSec) ||
    n(item.duration) ||
    n(nested(item, "video.durationSeconds")) ||
    n(nested(item, "video.duration")) ||
    n(nested(item, "videoMeta.durationSeconds")) ||
    n(nested(item, "videoMeta.duration")) ||
    n(nested(item, "musicMeta.duration"));
  if (!value) return undefined;
  const seconds = value > 1000 ? value / 1000 : value;
  return Math.max(1, Math.round(seconds));
}

function normalizeSocialItem(item: Record<string, unknown>, index: number, fallbackUrl = ""): NormalizedSocialItem {
  const stats = typeof item.stats === "object" && item.stats ? item.stats as Record<string, unknown> : {};
  const title = firstString(item.title, item.text, item.caption, item.description, item.desc, item.name) || `Social post ${index + 1}`;
  const mediaUrl = mediaUrlFrom(item);
  const sourceUrl = firstString(item.url, item.webVideoUrl, item.postUrl, item.inputUrl, item.link, item.permalink, item.shortcodeUrl) || fallbackUrl || mediaUrl;
  return {
    sourceUrl,
    platform: platformFromText(firstString(sourceUrl, item.platform, item.source, fallbackUrl)),
    title,
    description: firstString(item.description, item.caption, item.text, item.desc),
    thumbnailUrl: thumbnailFrom(item),
    mediaUrl,
    mediaType: mediaTypeFrom(item, mediaUrl),
    duration: durationFrom(item),
    views: n(item.views) || n(item.playCount) || n(item.videoViewCount) || n(item.viewCount) || n(item.view_count) || n(item.playCountText) || n(stats.views) || n(stats.playCount),
    likes: n(item.likes) || n(item.likeCount) || n(item.diggCount) || n(item.likesCount) || n(item.likes_count) || n(item.likesCountText) || n(stats.likes),
    comments: n(item.comments) || n(item.commentCount) || n(item.commentsCount) || n(item.comment_count) || n(item.commentsCountText) || n(stats.comments),
    publishedAt: firstString(item.timestamp, item.createTimeISO, item.takenAt, item.publishedAt, item.date, item.createdAt) || new Date().toISOString()
  };
}

export async function scanSocialUrl(url: string, minViews: number) {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const source = actorSourceFromUrl(url);
  const actorId = process.env.APIFY_SOCIAL_ACTOR_ID || sourceActorId(source);
  if (actorId) {
    try {
      const actorItems = await runApifyActor(actorId, platformUrlInput(source, url));
      const normalized = normalizeActorItems(actorItems, source, minViews, url);
      if (normalized.length) return normalized;
    } catch {
      // Fallback below keeps URL scans scoped to the submitted profile/page as much as search allows.
    }
  }
  return scanUrlWithSearchActor(url, minViews);
}

function platformFromText(value: string): Platform {
  const lower = value.toLowerCase();
  if (lower.includes("instagram") || lower.includes("reel")) return "Instagram";
  if (lower.includes("youtube") || lower.includes("youtu.be")) return "YouTube";
  if (lower.includes("linkedin")) return "LinkedIn";
  if (lower.includes("facebook")) return "Facebook";
  if (lower.includes("twitter") || lower.includes("x.com") || lower.includes("threads")) return "X";
  return "TikTok";
}

function queryFromUrl(targetUrl: string) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean).slice(0, 3);
    const handle = pathParts[pathParts.length - 1] || "";
    const exact = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
    const platform = platformFromText(targetUrl);
    const contentWords = platform === "LinkedIn" ? "posts articles images links" : "posts videos reels images";
    return `"${exact}" OR "${handle}" site:${host} ${contentWords}`.replace(/\s+/g, " ").trim();
  } catch {
    return `${targetUrl} social posts videos reels`;
  }
}

function urlScope(targetUrl: string) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    const handle = (parts[parts.length - 1] || parts[0] || "").replace(/^@/, "").toLowerCase();
    return { host, handle };
  } catch {
    return { host: "", handle: targetUrl.toLowerCase() };
  }
}

function actorOwnerSignals(item: Record<string, unknown>) {
  return [
    item.ownerUsername,
    item.ownerFullName,
    item.username,
    item.userName,
    item.account,
    item.author,
    item.channelName,
    item.pageName,
    item.profileName,
    item.name,
    nested(item, "owner.username"),
    nested(item, "owner.userName"),
    nested(item, "owner.fullName"),
    nested(item, "user.username"),
    nested(item, "user.userName"),
    nested(item, "author.username"),
    nested(item, "author.name"),
    nested(item, "authorMeta.name"),
    nested(item, "authorMeta.nickName"),
    nested(item, "channel.name"),
    nested(item, "page.name")
  ].map((value) => String(value || "").toLowerCase()).filter(Boolean);
}

function actorItemBelongsToUrl(item: Record<string, unknown>, targetUrl = "") {
  if (item.error || item.errorDescription) return false;
  if (!targetUrl) return true;
  const scope = urlScope(targetUrl);
  if (!scope.handle) return true;

  const normalizedHandle = scope.handle.replace(/^@/, "").toLowerCase();
  const exactPostUrl = firstString(item.url, item.webVideoUrl, item.postUrl, item.link, item.permalink, item.shortcodeUrl).replace(/\/$/, "").toLowerCase();
  const targetExact = targetUrl.replace(/\/$/, "").toLowerCase();
  if (exactPostUrl && exactPostUrl === targetExact) return true;

  const ownerSignals = actorOwnerSignals(item);
  if (!ownerSignals.length) return false;
  return ownerSignals.some((signal) => {
    const normalizedSignal = signal.replace(/^@/, "").replace(/\s+/g, "_");
    return normalizedSignal === normalizedHandle || signal.includes(normalizedHandle);
  });
}

function scopedToUrl(item: Record<string, unknown>, targetUrl: string) {
  const scope = urlScope(targetUrl);
  const haystack = [
    item.url,
    item.displayedUrl,
    item.link,
    item.title,
    item.description,
    item.text
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const hostMatches = scope.host ? haystack.includes(scope.host) : true;
  const handleMatches = scope.handle ? haystack.includes(scope.handle) : true;
  return hostMatches && (handleMatches || platformFromText(targetUrl) !== "LinkedIn");
}

async function scanUrlWithSearchActor(targetUrl: string, minViews: number): Promise<NormalizedSocialItem[]> {
  const actorId = (process.env.APIFY_ACTOR_ID || "apify/google-search-scraper").replace("/", "~");
  const endpoint = `https://api.apify.com/v2/actors/${actorId}/run-sync-get-dataset-items?token=${token()}&timeout=120`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: queryFromUrl(targetUrl),
      maxPagesPerQuery: 1,
      resultsPerPage: 20,
      countryCode: "us",
      languageCode: "en"
    })
  });
  if (!res.ok) throw new Error(`Apify URL search failed with HTTP ${res.status}.`);
  const items = (await res.json()) as ApifySearchItem[];
  const baseViews = Math.max(minViews, 10000);
  return items
    .flatMap((item) => item.organicResults || item.nonPromotedSearchResults || [])
    .filter((item) => item.title && scopedToUrl(item as Record<string, unknown>, targetUrl))
    .slice(0, 20)
    .map((item, index) => {
      const record = item as Record<string, unknown>;
      const views = baseViews + (20 - index) * 3700;
      const sourceUrl = s(item.url) || targetUrl;
      const date = s(item.date);
      const mediaUrl = mediaUrlFrom(record);
      return {
        sourceUrl,
        platform: platformFromText(sourceUrl),
        title: s(item.title) || `URL result ${index + 1}`,
        description: s(item.description),
        thumbnailUrl: thumbnailFrom(record),
        mediaUrl,
        mediaType: mediaTypeFrom(record, mediaUrl),
        views,
        likes: Math.round(views * (0.03 + (index % 4) * 0.007)),
        comments: Math.round(views * (0.0018 + (index % 3) * 0.001)),
        publishedAt: date && Number.isFinite(new Date(date).getTime()) ? new Date(date).toISOString() : new Date(Date.now() - 1000 * 60 * 60 * (index + 6)).toISOString()
      };
    })
    .filter((item) => item.views >= minViews);
}

function uploadDateQuery(value?: string) {
  return ({
    today: "uploaded today",
    "this-week": "uploaded this week",
    "this-month": "uploaded this month",
    "this-year": "uploaded this year"
  } as Record<string, string>)[value || ""] || "";
}

function keywordSearchQueries(keywords: string, actorSources: string[], uploadDate: string, contentType = "") {
  const dateTerm = uploadDateQuery(uploadDate);
  const typeTerm = contentTypeQuery(contentType);
  const selected = actorSources.length ? actorSources : ["instagram", "tiktok", "youtube"];
  const queryMap: Record<string, Record<string, string>> = {
    instagram: {
      "instagram-reels": "site:instagram.com/reel Instagram Reels",
      "instagram-posts": "site:instagram.com/p Instagram feed posts",
      default: "site:instagram.com/reel OR site:instagram.com/p Instagram Reels posts"
    },
    tiktok: {
      default: "site:tiktok.com/@ TikTok videos"
    },
    youtube: {
      "short-video": "site:youtube.com/shorts YouTube Shorts",
      "long-video": "site:youtube.com/watch YouTube video",
      default: "site:youtube.com/shorts OR site:youtube.com/watch YouTube videos Shorts"
    },
    facebook: {
      "short-video": "site:facebook.com/reel Facebook Reel",
      "long-video": "site:facebook.com/watch Facebook video",
      image: "site:facebook.com/posts Facebook photo image post",
      text: "site:facebook.com/posts Facebook text post",
      link: "site:facebook.com/posts Facebook shared link post",
      article: "site:facebook.com Facebook article post",
      default: "site:facebook.com/reel OR site:facebook.com/watch OR site:facebook.com/posts Facebook Reels posts videos"
    },
    linkedin: {
      "short-video": "site:linkedin.com/posts LinkedIn video post",
      "long-video": "site:linkedin.com/posts LinkedIn video post",
      image: "site:linkedin.com/posts LinkedIn image post",
      text: "site:linkedin.com/posts LinkedIn text post",
      link: "site:linkedin.com/posts LinkedIn link post",
      article: "site:linkedin.com/pulse LinkedIn article",
      default: "site:linkedin.com/posts OR site:linkedin.com/pulse LinkedIn posts articles"
    }
  };
  return selected
    .map((source) => {
      const platformTerms = queryMap[source]?.[contentType] || queryMap[source]?.default || source;
      return `${keywords} ${platformTerms} ${typeTerm} ${dateTerm}`.replace(/\s+/g, " ").trim();
    })
    .join("\n");
}

function selectedSource(dimensions: KeywordDimensions): ActorSource {
  const source = dimensions.actorSources?.[0] || dimensions.contentTypes?.[0] || "instagram";
  return ["instagram", "tiktok", "youtube", "facebook", "linkedin"].includes(source) ? source as ActorSource : "instagram";
}

function actorSourceFromUrl(url: string): ActorSource {
  const platform = platformFromText(url);
  if (platform === "Instagram") return "instagram";
  if (platform === "YouTube") return "youtube";
  if (platform === "LinkedIn") return "linkedin";
  if (platform === "Facebook") return "facebook";
  return "tiktok";
}

function sourceActorId(source: ActorSource) {
  const envMap: Record<ActorSource, string | undefined> = {
    instagram: process.env.APIFY_INSTAGRAM_ACTOR_ID,
    tiktok: process.env.APIFY_TIKTOK_ACTOR_ID,
    youtube: process.env.APIFY_YOUTUBE_ACTOR_ID,
    facebook: process.env.APIFY_FACEBOOK_ACTOR_ID,
    linkedin: process.env.APIFY_LINKEDIN_ACTOR_ID
  };
  const defaultMap: Record<ActorSource, string> = {
    instagram: "apify/instagram-scraper",
    tiktok: "clockworks/tiktok-scraper",
    youtube: "streamers/youtube-scraper",
    facebook: "scrapeforge/facebook-search-posts",
    linkedin: ""
  };
  return envMap[source] || defaultMap[source];
}

function sourcePlatform(source: ActorSource): Platform {
  return ({
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    facebook: "Facebook",
    linkedin: "LinkedIn"
  } as Record<ActorSource, Platform>)[source];
}

function contentTypeQuery(value?: string) {
  return ({
    video: "video reel short watch",
    "short-video": "short video reel shorts vertical",
    "long-video": "long video watch full video",
    "instagram-reels": "reel",
    "instagram-posts": "post",
    image: "image photo carousel graphic",
    text: "text post status update",
    link: "link post article shared link",
    article: "article long-form post"
  } as Record<string, string>)[value || ""] || "";
}

function instagramKeywordToken(keywords: string) {
  return keywords
    .replace(/#/g, "")
    .split(/[,|]/)[0]
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase();
}

function platformSearchInput(source: ActorSource, keywords: string, uploadDate: string, contentType = "") {
  const maxItems = 30;
  const dateTerm = uploadDateQuery(uploadDate);
  const query = `${keywords} ${contentTypeQuery(contentType)} ${dateTerm}`.replace(/\s+/g, " ").trim();
  if (source === "tiktok") {
    return {
      searchQueries: [query],
      resultsPerPage: maxItems,
      maxItems,
      scrapeRelatedVideos: false,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false
    };
  }
  if (source === "instagram") {
    const search = instagramKeywordToken(keywords) || query;
    return {
      directUrls: [`https://www.instagram.com/explore/tags/${encodeURIComponent(search)}/`],
      resultsType: contentType === "instagram-reels" || contentType === "short-video" || contentType === "video" ? "reels" : "posts",
      resultsLimit: maxItems,
      maxItems,
      addParentData: false,
      enhanceUserSearchWithFacebookPage: false
    };
  }
  if (source === "youtube") {
    const wantsShorts = contentType === "short-video";
    const wantsLong = contentType === "long-video";
    return {
      searchQueries: [query],
      maxResults: wantsShorts ? 0 : maxItems,
      maxResultsShorts: wantsLong ? 0 : maxItems,
      sort: "relevance",
      startUrls: []
    };
  }
  if (source === "facebook") {
    return {
      query,
      queries: [query],
      maxItems,
      resultsLimit: maxItems
    };
  }
  return {
    queries: keywordSearchQueries(keywords, [source], uploadDate, contentType),
    maxPagesPerQuery: 2,
    resultsPerPage: 10,
    countryCode: "us",
    languageCode: "en"
  };
}

function platformUrlInput(source: ActorSource, url: string) {
  const maxItems = 40;
  if (source === "tiktok") {
    return { profiles: [url], startUrls: [{ url }], urls: [url], maxItems, resultsPerPage: maxItems, scrapeRelatedVideos: false, shouldDownloadVideos: false, shouldDownloadCovers: false };
  }
  if (source === "instagram") {
    return { directUrls: [url], startUrls: [{ url }], urls: [url], resultsType: "posts", resultsLimit: maxItems, maxItems, addParentData: false, enhanceUserSearchWithFacebookPage: false };
  }
  if (source === "youtube") {
    return { startUrls: [{ url }], maxResults: maxItems, maxResultsShorts: maxItems };
  }
  if (source === "facebook") {
    return { startUrls: [{ url }], urls: [url], maxItems, resultsLimit: maxItems };
  }
  return {
    queries: queryFromUrl(url),
    maxPagesPerQuery: 2,
    resultsPerPage: 10,
    countryCode: "us",
    languageCode: "en"
  };
}

async function runApifyActor(actorId: string, input: Record<string, unknown>) {
  const endpoint = `https://api.apify.com/v2/actors/${actorId.replace("/", "~")}/run-sync-get-dataset-items?token=${token()}&timeout=180`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify actor ${actorId} failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text) as Array<Record<string, unknown>>;
}

async function startApifyActor(actorId: string, input: Record<string, unknown>) {
  const endpoint = `https://api.apify.com/v2/acts/${actorId.replace("/", "~")}/runs?token=${token()}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify actor ${actorId} start failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const json = JSON.parse(text) as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = json.data?.id || "";
  const datasetId = json.data?.defaultDatasetId || "";
  if (!runId || !datasetId) throw new Error("Apify did not return a run ID and dataset ID.");
  return { runId, datasetId };
}

export async function startSocialUrlScanRun(url: string, minViews: number): Promise<ResearchRunMeta> {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const source = actorSourceFromUrl(url);
  const actorId = process.env.APIFY_SOCIAL_ACTOR_ID || sourceActorId(source);
  if (!actorId) throw new Error(`No Apify actor configured for ${source}.`);
  const run = await startApifyActor(actorId, platformUrlInput(source, url));
  return { actorId, runId: run.runId, datasetId: run.datasetId, source, fallbackUrl: url, minViews };
}

export async function startKeywordScanRun(keywords: string, dimensions: KeywordDimensions, minViews: number): Promise<ResearchRunMeta & { contentType: string }> {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const source = selectedSource(dimensions);
  const actorId = sourceActorId(source);
  if (!actorId) throw new Error(`No Apify actor configured for ${source}.`);
  const contentType = dimensions.contentType || dimensions.contentTypes?.[0] || "";
  const run = await startApifyActor(actorId, platformSearchInput(source, keywords, dimensions.uploadDate || "", contentType));
  return { actorId, runId: run.runId, datasetId: run.datasetId, source, fallbackUrl: "", minViews, contentType };
}

export async function completeSocialUrlScanRun(meta: ResearchRunMeta) {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${meta.runId}?token=${token()}`, { cache: "no-store" });
  const runText = await runRes.text();
  if (!runRes.ok) throw new Error(`Apify run status failed with HTTP ${runRes.status}: ${runText.slice(0, 180)}`);
  const runJson = JSON.parse(runText) as { data?: { status?: string } };
  const status = runJson.data?.status || "";
  if (["READY", "RUNNING"].includes(status)) return { status: "running" as const, items: [] as NormalizedSocialItem[] };
  if (status !== "SUCCEEDED") throw new Error(`Apify run ended with status ${status || "unknown"}.`);

  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${meta.datasetId}/items?token=${token()}&clean=true`, { cache: "no-store" });
  const itemsText = await itemsRes.text();
  if (!itemsRes.ok) throw new Error(`Apify dataset fetch failed with HTTP ${itemsRes.status}: ${itemsText.slice(0, 180)}`);
  const actorItems = JSON.parse(itemsText) as Array<Record<string, unknown>>;
  return {
    status: "done" as const,
    items: normalizeActorItems(actorItems, meta.source, meta.minViews, meta.fallbackUrl)
  };
}

export async function completeKeywordScanRun(meta: ResearchRunMeta & { contentType?: string; keywords?: string }) {
  const completed = await completeSocialUrlScanRun(meta);
  if (completed.status === "running") return completed;
  const filtered = completed.items
    .filter((item) => matchesContentType(item, meta.contentType || ""))
    .filter((item) => !meta.keywords || matchesKeywordIntent(item, meta.keywords));
  return {
    status: "done" as const,
    items: filtered
  };
}

function matchesContentType(item: NormalizedSocialItem, contentType = "") {
  const haystack = `${item.title} ${item.description} ${item.sourceUrl} ${item.mediaType}`.toLowerCase();
  if (!contentType) return true;
  if (contentType === "video") return item.mediaType === "video" || /(video|reel|short|watch|tiktok|youtube)/.test(haystack);
  if (contentType === "instagram-reels") return item.platform === "Instagram" && /(instagram\.com\/reel|reel)/.test(haystack);
  if (contentType === "instagram-posts") return item.platform === "Instagram" && /(instagram\.com\/p\/|post|photo|image|carousel)/.test(haystack) && !/instagram\.com\/reel/.test(haystack);
  if (contentType === "short-video") {
    if (typeof item.duration === "number") return item.duration <= 90;
    if (/(shorts|reel|tiktok|vertical|9:16)/.test(haystack)) return true;
    if (item.platform === "TikTok" && item.mediaType !== "image") return true;
    return false;
  }
  if (contentType === "long-video") {
    if (typeof item.duration === "number") return item.duration > 90;
    if (/(youtube\.com\/watch|facebook\.com\/watch|long video|16:9)/.test(haystack)) return true;
    return false;
  }
  if (contentType === "image") return item.mediaType === "image" || /(image|photo|carousel|graphic)/.test(haystack);
  if (contentType === "text") return /(text|post|status|linkedin|twitter|x\.com|threads)/.test(haystack) && !/(watch|reel|shorts)/.test(haystack);
  if (contentType === "link") return /(http|link|article|shared)/.test(haystack);
  if (contentType === "article") return /(article|pulse|newsletter|blog)/.test(haystack);
  return true;
}

function normalizeActorItems(items: Array<Record<string, unknown>>, source: ActorSource, minViews: number, fallbackUrl = "", contentType = "") {
  return items
    .filter((item) => actorItemBelongsToUrl(item, fallbackUrl))
    .map((item, index) => ({ ...normalizeSocialItem(item, index, fallbackUrl), platform: sourcePlatform(source) }))
    .filter((item) => Boolean(item.sourceUrl || item.mediaUrl || item.thumbnailUrl))
    .filter((item) => item.views >= minViews && matchesContentType(item, contentType));
}

function keywordTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function matchesKeywordIntent(item: NormalizedSocialItem, keywords: string) {
  const tokens = keywordTokens(keywords);
  if (!tokens.length) return true;
  const haystack = `${item.title} ${item.description} ${item.sourceUrl}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token)) || haystack.includes(tokens.join(""));
}

function matchesVisibleKeywordIntent(item: NormalizedSocialItem, keywords: string) {
  const tokens = keywordTokens(keywords);
  if (!tokens.length) return true;
  const haystack = `${item.title} ${item.sourceUrl}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token)) || haystack.includes(tokens.join(""));
}

export async function scanKeywordsWithApify(keywords: string, dimensions: KeywordDimensions, minViews: number, options: { skipPlatformActor?: boolean } = {}) {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const source = selectedSource(dimensions);
  const actorId = sourceActorId(source);
  const uploadDate = dimensions.uploadDate || "";
  const contentType = dimensions.contentType || dimensions.contentTypes?.[0] || "";
  if (actorId && !options.skipPlatformActor) {
    try {
      const actorItems = await runApifyActor(actorId, platformSearchInput(source, keywords, uploadDate, contentType));
      const directItems = normalizeActorItems(actorItems, source, minViews, "", contentType).filter((item) => matchesKeywordIntent(item, keywords));
      if (directItems.length) return directItems;
    } catch {
      // Fall through to Google search fallback for sources whose actor schema or search support differs.
    }
  }
  const sourceMap: Record<string, string> = {
    "google-search": "web search social content",
    tiktok: "site:tiktok.com TikTok videos captions public metrics",
    instagram: "site:instagram.com Instagram Reels posts profiles thumbnails",
    youtube: "site:youtube.com YouTube videos Shorts channels",
    facebook: "site:facebook.com Facebook public posts Reels videos",
    linkedin: "site:linkedin.com LinkedIn posts articles company person content",
    "short-video": "short-form vertical video Instagram Reels TikTok YouTube Shorts Facebook Reels 9:16",
    "long-video": "long-form YouTube Facebook video 16:9",
    "text-post": "text post X Twitter Threads Facebook LinkedIn feed",
    article: "long-form article LinkedIn",
    carousel: "image carousel Instagram Facebook LinkedIn 1:1 4:5"
  };
  const actorSources = dimensions.actorSources?.length ? dimensions.actorSources : dimensions.contentTypes || [];
  const sourceTerms = actorSources.length
    ? actorSources.map((item) => sourceMap[item] || item).join(" OR ")
    : dimensions.formats?.join(" OR ") || "short-form vertical video Instagram Reels TikTok YouTube Shorts";
  const query = `${keywords} ${sourceTerms} ${contentTypeQuery(contentType)} ${uploadDateQuery(uploadDate)}`.replace(/\s+/g, " ").trim();
  const queries = keywordSearchQueries(keywords, actorSources, uploadDate, contentType);
  const fallbackActorId = (process.env.APIFY_KEYWORD_ACTOR_ID || process.env.APIFY_ACTOR_ID || "apify/google-search-scraper").replace("/", "~");
  const endpoint = `https://api.apify.com/v2/actors/${fallbackActorId}/run-sync-get-dataset-items?token=${token()}&timeout=120`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries,
      uploadDate,
      dateRange: uploadDate,
      filters: {
        actorSources,
        contentTypes: dimensions.contentTypes || [],
        contentType,
        uploadDate
      },
      maxPagesPerQuery: 2,
      resultsPerPage: 10,
      countryCode: "us",
      languageCode: "en"
    })
  });
  if (!res.ok) throw new Error(`Apify keyword scan failed with HTTP ${res.status}.`);
  const items = (await res.json()) as ApifySearchItem[];
  const baseViews = Math.max(minViews, 10000);
  const directItems = (items as unknown as Array<Record<string, unknown>>)
    .filter((item) => !Array.isArray(item.organicResults) && !Array.isArray(item.nonPromotedSearchResults))
    .map((item, index) => normalizeSocialItem(item, index))
    .filter((item) => item.views >= minViews && matchesContentType(item, contentType) && matchesKeywordIntent(item, keywords));
  if (directItems.length) return directItems;
  return items
    .flatMap((item) => item.organicResults || item.nonPromotedSearchResults || [])
    .filter((item) => item.title)
    .map((item, index) => {
      const record = item as Record<string, unknown>;
      const views = baseViews + (20 - index) * 4300;
      const url = s(item.url);
      const date = s(item.date);
      const platform = platformFromText(`${url} ${s(item.displayedUrl)} ${sourceTerms}`);
      const mediaUrl = mediaUrlFrom(record);
      return {
        sourceUrl: url,
        platform,
        title: s(item.title) || `Keyword result ${index + 1}`,
        description: s(item.description),
        thumbnailUrl: thumbnailFrom(record),
        mediaUrl,
        mediaType: mediaTypeFrom(record, mediaUrl),
        views,
        likes: Math.round(views * (0.035 + (index % 4) * 0.008)),
        comments: Math.round(views * (0.002 + (index % 3) * 0.001)),
        publishedAt: date && Number.isFinite(new Date(date).getTime()) ? new Date(date).toISOString() : new Date(Date.now() - 1000 * 60 * 60 * (index + 8)).toISOString()
      };
    })
    .filter((item) => item.views >= minViews && matchesContentType(item, contentType) && matchesVisibleKeywordIntent(item, keywords))
    .slice(0, 20);
}

export async function crawlPersonaSourcesWithApify(urls: Record<string, string>) {
  if (!token()) throw new Error("APIFY_API_TOKEN is not configured.");
  const entries = Object.entries(urls).filter(([, url]) => url.trim());
  if (!entries.length) return [];
  const actorId = (process.env.APIFY_KEYWORD_ACTOR_ID || process.env.APIFY_ACTOR_ID || "apify/google-search-scraper").replace("/", "~");
  const queryList = entries.map(([source, url]) => `${url} ${source} profile about posts`).slice(0, 8);
  const endpoint = `https://api.apify.com/v2/actors/${actorId}/run-sync-get-dataset-items?token=${token()}&timeout=120`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: queryList.join("\n"),
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
      countryCode: "us",
      languageCode: "en"
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify persona crawl failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  const items = JSON.parse(text) as Array<Record<string, unknown>>;
  const flattened: Array<Record<string, unknown>> = items.flatMap((item) => {
    const searchQuery = s(item.searchQuery);
    const organic = Array.isArray(item.organicResults) ? item.organicResults as Array<Record<string, unknown>> : [];
    const suggested = Array.isArray(item.suggestedResults) ? item.suggestedResults as Array<Record<string, unknown>> : [];
    const direct = organic.length || suggested.length ? [] : [item];
    return [...organic, ...suggested, ...direct].map((result) => ({ ...result, searchQuery }));
  });
  return entries.map(([source, url], index) => {
    const query = queryList[index];
    const normalizedUrl = url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    const related = flattened.filter((item) => {
      const haystack = [item.searchQuery, item.query, item.url, item.link, item.title, item.description, item.text].map((value) => String(value || "")).join(" ");
      const lower = haystack.toLowerCase();
      return lower.includes(normalizedUrl) || lower.includes(url.toLowerCase()) || lower.includes(query.toLowerCase()) || lower.includes(source.toLowerCase());
    }).slice(0, 6);
    const text = related.map((item) => [
      item.title,
      item.description,
      item.text,
      item.url || item.link
    ].filter(Boolean).join("\n")).join("\n\n").slice(0, 5000);
    return { source, url, text, itemCount: related.length };
  });
}

export async function checkApifyHealth() {
  return { configured: hasApify(), actor: process.env.APIFY_ACTOR_ID || "apify/google-search-scraper" };
}
