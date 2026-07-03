import type { Platform } from "@/lib/types";
import { getProviderApiKey } from "@/lib/apiKeyOverrides";

const baseUrl = "https://api.upload-post.com/api";

async function token() {
  return getProviderApiKey("uploadPost");
}

function profile() {
  return process.env.UPLOAD_POST_PROFILE || "contentagent-demo";
}

function mapPlatform(platform: Platform | string) {
  return platform.toLowerCase();
}

function defaultPlatforms() {
  return (process.env.UPLOAD_POST_DEFAULT_PLATFORMS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function targetPlatforms(platform?: Platform) {
  const defaults = defaultPlatforms();
  return defaults.length > 0 ? defaults : platform ? [mapPlatform(platform)] : ["tiktok"];
}

function platformLabel(platform: string): Platform | "Unknown" {
  const normalized = platform.toLowerCase();
  if (normalized === "tiktok") return "TikTok";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "youtube") return "YouTube";
  if (normalized === "linkedin") return "LinkedIn";
  if (normalized === "facebook") return "Facebook";
  if (normalized === "x" || normalized === "twitter") return "X";
  return "Unknown";
}

function accountUrl(platform: Platform | "Unknown", handle: string) {
  const clean = handle.trim().replace(/^@/, "");
  if (!clean) return "";
  if (platform === "TikTok") return `https://www.tiktok.com/@${clean}`;
  if (platform === "Instagram") return `https://www.instagram.com/${clean}`;
  if (platform === "YouTube") return clean.startsWith("http") ? clean : `https://www.youtube.com/@${clean}`;
  if (platform === "LinkedIn") return clean.startsWith("http") ? clean : `https://www.linkedin.com/in/${clean}`;
  if (platform === "Facebook") return clean.startsWith("http") ? clean : `https://www.facebook.com/${encodeURIComponent(clean)}`;
  if (platform === "X") return `https://x.com/${clean}`;
  return "";
}

export async function hasUploadPost() {
  return Boolean(await token());
}

export async function verifyUploadPost() {
  const apiToken = await token();
  if (!apiToken) return { configured: false };
  const res = await fetch(`${baseUrl}/uploadposts/users`, {
    headers: { Authorization: `Apikey ${apiToken}` }
  });
  if (!res.ok) return { configured: true, ok: false, status: res.status };
  const json = await res.json();
  const profiles = Array.isArray(json?.profiles) ? json.profiles : [];
  return {
    configured: true,
    ok: true,
    status: res.status,
    plan: json?.plan,
    profileCount: profiles.length,
    activeProfile: profile(),
    activeProfileExists: profiles.some((item: { username?: string }) => item.username === profile())
  };
}

export async function getConnectedUploadPostAccounts() {
  const apiToken = await token();
  if (!apiToken) return [];
  const res = await fetch(`${baseUrl}/uploadposts/users`, {
    headers: { Authorization: `Apikey ${apiToken}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  const profiles = Array.isArray(json?.profiles) ? json.profiles : [];
  const active = profiles.find((item: { username?: string }) => item.username === profile());
  const socialAccounts = active?.social_accounts || {};
  return Object.entries(socialAccounts)
    .map(([key, value]) => {
      const account = (value || {}) as { display_name?: string; handle?: string; social_images?: string; reauth_required?: boolean };
      const platform = platformLabel(key);
      const handle = String(account.handle || "").trim();
      return {
        platform,
        handle,
        displayName: account.display_name || handle || key,
        imageUrl: account.social_images || "",
        reauthRequired: Boolean(account.reauth_required),
        url: accountUrl(platform, handle)
      };
    })
    .filter((item) => item.platform !== "Unknown" && item.handle && item.url);
}

export async function ensureUploadPostProfile() {
  const apiToken = await token();
  if (!apiToken) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  const res = await fetch(`${baseUrl}/uploadposts/users`, {
    method: "POST",
    headers: {
      Authorization: `Apikey ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: profile() })
  });
  if (res.status === 409) return { existed: true };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error || `Upload-Post profile create failed with HTTP ${res.status}.`);
  return json;
}

export async function createUploadPostConnectionUrl() {
  const apiToken = await token();
  if (!apiToken) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const res = await fetch(`${baseUrl}/uploadposts/users/generate-jwt`, {
    method: "POST",
    headers: {
      Authorization: `Apikey ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: profile(),
      connect_title: "Connect ContentAgent Social",
      connect_description: "Connect the social accounts you want ContentAgent to publish to.",
      platforms: defaultPlatforms().length > 0 ? defaultPlatforms() : ["tiktok", "instagram", "linkedin", "facebook", "x"],
      show_calendar: true,
      language: "en"
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error || `Upload-Post connection URL failed with HTTP ${res.status}.`);
  return json as { success?: boolean; access_url?: string; duration?: string };
}

export async function publishTextPost(input: {
  title: string;
  description?: string;
  platform: Platform;
  scheduledAt?: string;
}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const form = new FormData();
  form.append("user", profile());
  targetPlatforms(input.platform).forEach((platform) => form.append("platform[]", platform));
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.scheduledAt) form.append("scheduled_date", input.scheduledAt);
  form.append("async_upload", "true");

  const res = await fetch(`${baseUrl}/upload_text`, {
    method: "POST",
    headers: { Authorization: `Apikey ${apiToken}` },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Upload-Post failed with HTTP ${res.status}.`);
  }
  return json as { request_id?: string; job_id?: string; success?: boolean; message?: string };
}

export async function publishVideoPost(input: {
  title: string;
  description?: string;
  platform: Platform;
  videoUrl: string;
  scheduledAt?: string;
}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const form = new FormData();
  form.append("user", profile());
  targetPlatforms(input.platform).forEach((platform) => form.append("platform[]", platform));
  form.append("video", input.videoUrl);
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.scheduledAt) form.append("scheduled_date", input.scheduledAt);
  form.append("async_upload", "true");
  form.append("is_aigc", "true");

  const res = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    headers: { Authorization: `Apikey ${apiToken}` },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Upload-Post video upload failed with HTTP ${res.status}.`);
  }
  return json as { request_id?: string; job_id?: string; success?: boolean; message?: string };
}

export async function publishPhotoPost(input: {
  title: string;
  description?: string;
  platform: Platform;
  photoUrl: string;
  scheduledAt?: string;
}) {
  const apiToken = await token();
  if (!apiToken) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const form = new FormData();
  form.append("user", profile());
  targetPlatforms(input.platform).forEach((platform) => form.append("platform[]", platform));
  form.append("photos[]", input.photoUrl);
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.scheduledAt) form.append("scheduled_date", input.scheduledAt);
  form.append("async_upload", "true");

  const res = await fetch(`${baseUrl}/upload_photos`, {
    method: "POST",
    headers: { Authorization: `Apikey ${apiToken}` },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Upload-Post photo upload failed with HTTP ${res.status}.`);
  }
  return json as { request_id?: string; job_id?: string; success?: boolean; message?: string };
}

export async function checkUploadPostHealth() {
  return verifyUploadPost();
}

