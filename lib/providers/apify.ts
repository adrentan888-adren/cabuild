type ApifySearchItem = {
  organicResults?: Array<{ title?: string; description?: string; url?: string }>;
  nonPromotedSearchResults?: Array<{ title?: string; description?: string; url?: string }>;
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
      queries: `${niche} AI automation social media trend`,
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
      title: item.title || `Trend signal ${index + 1}`,
      description: item.description || "",
      url: item.url || ""
    }));
}

export async function checkApifyHealth() {
  return { configured: hasApify(), actor: process.env.APIFY_ACTOR_ID || "apify/google-search-scraper" };
}
