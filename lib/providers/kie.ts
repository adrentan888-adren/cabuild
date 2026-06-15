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

export async function generateVeoVideo(prompt: string) {
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
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: 8,
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
