import type { Platform } from "@/lib/types";

const baseUrl = "https://api.upload-post.com/api";

function token() {
  return process.env.UPLOAD_POST_API_KEY;
}

function profile() {
  return process.env.UPLOAD_POST_PROFILE || "contentagent-demo";
}

function mapPlatform(platform: Platform) {
  return platform.toLowerCase();
}

export function hasUploadPost() {
  return Boolean(token());
}

export async function verifyUploadPost() {
  if (!token()) return { configured: false };
  const res = await fetch(`${baseUrl}/uploadposts/users`, {
    headers: { Authorization: `Apikey ${token()}` }
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

export async function ensureUploadPostProfile() {
  if (!token()) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  const res = await fetch(`${baseUrl}/uploadposts/users`, {
    method: "POST",
    headers: {
      Authorization: `Apikey ${token()}`,
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
  if (!token()) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const res = await fetch(`${baseUrl}/uploadposts/users/generate-jwt`, {
    method: "POST",
    headers: {
      Authorization: `Apikey ${token()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: profile(),
      connect_title: "Connect ContentAgent Social",
      connect_description: "Connect the social accounts you want ContentAgent to publish to.",
      platforms: ["tiktok", "instagram", "linkedin", "facebook"],
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
  if (!token()) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const form = new FormData();
  form.append("user", profile());
  form.append("platform[]", mapPlatform(input.platform));
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.scheduledAt) form.append("scheduled_date", input.scheduledAt);
  form.append("async_upload", "true");

  const res = await fetch(`${baseUrl}/upload_text`, {
    method: "POST",
    headers: { Authorization: `Apikey ${token()}` },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Upload-Post failed with HTTP ${res.status}.`);
  }
  return json as { request_id?: string; success?: boolean; message?: string };
}

export async function publishVideoPost(input: {
  title: string;
  description?: string;
  platform: Platform;
  videoUrl: string;
  scheduledAt?: string;
}) {
  if (!token()) throw new Error("UPLOAD_POST_API_KEY is not configured.");
  await ensureUploadPostProfile();
  const form = new FormData();
  form.append("user", profile());
  form.append("platform[]", mapPlatform(input.platform));
  form.append("video", input.videoUrl);
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.scheduledAt) form.append("scheduled_date", input.scheduledAt);
  form.append("async_upload", "true");
  form.append("is_aigc", "true");

  const res = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    headers: { Authorization: `Apikey ${token()}` },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Upload-Post video upload failed with HTTP ${res.status}.`);
  }
  return json as { request_id?: string; success?: boolean; message?: string };
}

export async function checkUploadPostHealth() {
  return verifyUploadPost();
}
