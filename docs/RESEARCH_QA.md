# Research QA Coverage Matrix

Static analysis only. No live Apify, social URL, curl, or dev-server calls were made for this report.

## UI Surface

Research is implemented in `app/page.tsx`.

Search modes:
- URL research: paste a social URL plus minimum views.
- Keyword research: enter keywords, minimum views, upload date, one platform, and an optional content type.

Keyword platform dropdown:
- Instagram (`instagram`)
- TikTok (`tiktok`)
- YouTube (`youtube`)
- Facebook (`facebook`)
- LinkedIn (`linkedin`)

Keyword content-type options:
- All types (`""`) for every platform.
- Instagram Reels (`instagram-reels`) for Instagram only.
- Instagram Posts (`instagram-posts`) for Instagram only.
- LinkedIn Articles (`article`) for LinkedIn only.

URL input placeholder promises:
- LinkedIn
- TikTok
- Instagram
- YouTube
- Facebook
- X

## Static Auth Check

All `/api/social` POST actions, including `scanResearchUrl`, `scanKeywordResearch`, and `syncResearchScan`, call `requireUser()` before reading the request body. `requireUser()` reads the signed `ca_session` cookie through `currentUser()`. There is no per-request API key for these research actions. A caller must be logged in and send a valid session cookie.

## Backend Routing Summary

`scanResearchUrl` in `app/api/social/route.ts`:
- Accepts any `url` string from the request body; there is no explicit URL-format validation in this action.
- Derives `ResearchScan.platform` with local `platformFromUrl()`:
  - Instagram if URL contains `instagram.com`
  - TikTok if URL contains `tiktok.com`
  - Facebook if URL contains `facebook.com` or `fb.watch`
  - LinkedIn if URL contains `linkedin.com`
  - X if URL contains `x.com` or `twitter.com`
  - Otherwise TikTok
- Starts Apify through `startSocialUrlScanRun(url, minViews)` in `lib/providers/apify.ts`.
- Completion later rebuilds the provider `source` from saved `scan.platform`, not from the provider's original detection.

`scanKeywordResearch` in `app/api/social/route.ts`:
- Accepts `keywords`, `minViews`, and `dimensions`.
- Uses `dimensions.actorSources[0]` as the selected platform, defaulting to Instagram.
- Normalizes content type with `keywordContentTypesByPlatform`:
  - Instagram: `instagram-reels`, `instagram-posts`
  - TikTok: no specific content type
  - YouTube: no specific content type
  - Facebook: no specific content type
  - LinkedIn: `article`
- Unsupported/legacy content types are dropped to All types, except legacy Instagram `video`/`short-video` map to Reels and `image`/`carousel` map to Posts.

`lib/providers/apify.ts`:
- `scanSocialUrl()` requires `APIFY_API_TOKEN`.
- URL platform detection happens again with `actorSourceFromUrl()` via `platformFromText()`:
  - Instagram -> `instagram`
  - YouTube -> `youtube`
  - LinkedIn -> `linkedin`
  - Facebook -> `facebook`
  - Everything else, including X, falls back to `tiktok`
- URL actor defaults:
  - Instagram: `apify/instagram-scraper`
  - TikTok: `clockworks/tiktok-scraper`
  - YouTube: `streamers/youtube-scraper`
  - Facebook: `scrapeforge/facebook-search-posts`
  - LinkedIn: no default actor
  - Any platform can be overridden globally by `APIFY_SOCIAL_ACTOR_ID`.
- Keyword actor defaults:
  - Instagram: `APIFY_INSTAGRAM_KEYWORD_ACTOR_ID` or `apify/instagram-hashtag-scraper`
  - TikTok: `clockworks/tiktok-scraper`
  - YouTube: `streamers/youtube-scraper`
  - Facebook: `scrapeforge/facebook-search-posts`
  - LinkedIn: no default actor
- Keyword fallback uses `APIFY_KEYWORD_ACTOR_ID`, `APIFY_ACTOR_ID`, or `apify/google-search-scraper`.

## Keyword Coverage Matrix

| Platform | Content Type | UI-supported | Backend-supported | Requires live `APIFY_API_TOKEN` | Sample keyword | Notes |
|---|---:|---:|---:|---:|---|---|
| Instagram | All types | Yes | Yes | Yes | `ai automation` | Starts Instagram hashtag actor by default, then can fall back to Google search actor. |
| Instagram | Reels (`instagram-reels`) | Yes | Yes | Yes | `ai automation` | Valid content type. Provider searches hashtag token and filters for Reel/video signals. |
| Instagram | Posts (`instagram-posts`) | Yes | Yes | Yes | `ai automation` | Valid content type. Provider filters for Instagram `/p/`, image, photo, carousel, or post signals. |
| TikTok | All types | Yes | Yes | Yes | `ai automation` | UI exposes no narrower TikTok content type. Uses TikTok actor by default. |
| TikTok | Short video | No | No via UI/API normalization | Yes if added later | `ai automation` | Provider has latent `short-video` filtering, but UI does not expose it and `scanKeywordResearch` normalizes unsupported TikTok content types to All types. |
| YouTube | All types | Yes | Yes | Yes | `ai automation` | UI exposes no Shorts/long-form selector. Provider can query both `maxResults` and `maxResultsShorts`. |
| YouTube | Shorts | No | No via UI/API normalization | Yes if added later | `ai automation` | Provider has latent `short-video` support, but UI does not expose it and backend normalization drops it for YouTube. |
| YouTube | Long-form video | No | No via UI/API normalization | Yes if added later | `ai automation` | Provider has latent `long-video` support, but UI does not expose it and backend normalization drops it for YouTube. |
| Facebook | All types | Yes | Yes | Yes | `ai automation` | UI exposes no narrower Facebook type. Uses Facebook actor if configured/default works, then may fall back to Google search actor for keyword scans. |
| Facebook | Reels/video/image/text/link/article | No | No via UI/API normalization | Yes if added later | `ai automation` | Provider has latent query strings for several Facebook types, but UI does not expose them and backend normalization drops them for Facebook. |
| LinkedIn | All types | Yes | Partial | Yes | `ai automation` | UI exposes it. No default LinkedIn platform actor is configured, so it depends on `APIFY_LINKEDIN_ACTOR_ID` or keyword fallback. |
| LinkedIn | Articles (`article`) | Yes | Partial | Yes | `ai automation` | Valid content type. No default LinkedIn platform actor is configured; fallback Google search actor can search `site:linkedin.com/pulse`. |
| X | Any keyword type | No | No | Yes if added later | `ai automation` | Keyword platform dropdown does not include X, and backend selected-source whitelist excludes X. |

## URL Coverage Matrix

URL research has no content-type selector. The entries below describe static support for pasted URL patterns.

| Platform | Sample URL pattern | UI-promised | Backend platform detection | Provider actor routing | Requires live `APIFY_API_TOKEN` | Notes |
|---|---|---:|---:|---:|---:|---|
| Instagram | `https://www.instagram.com/reel/...` | Yes | Yes: Instagram | Yes: Instagram actor | Yes | Same route also accepts `/p/...`; URL scan asks the Instagram actor for posts and then filters to the submitted owner/post scope. |
| Instagram | `https://www.instagram.com/p/...` | Yes | Yes: Instagram | Yes: Instagram actor | Yes | No URL-level content-type field; media type is inferred from actor/search results. |
| TikTok | `https://www.tiktok.com/@user/video/...` | Yes | Yes: TikTok | Yes: TikTok actor | Yes | Default actor is `clockworks/tiktok-scraper` unless overridden. |
| YouTube | `https://www.youtube.com/watch?v=...` | Yes | No: saved as TikTok by `platformFromUrl()` | Provider initially detects YouTube | Yes | Mismatch: `scanResearchUrl` stores platform as TikTok because it does not check YouTube. `startSocialUrlScanRun()` detects YouTube internally, but `syncResearchScan()` later reconstructs source from saved scan platform and can normalize completion as TikTok. |
| YouTube | `https://www.youtube.com/shorts/...` | Yes | No: saved as TikTok by `platformFromUrl()` | Provider initially detects YouTube | Yes | Same mismatch as YouTube watch URLs. This is a UI/backend inconsistency worth fixing before deeper live QA. |
| Facebook | `https://www.facebook.com/...` | Yes | Yes: Facebook | Yes: Facebook actor | Yes | Default actor is `scrapeforge/facebook-search-posts`; its expected input schema must match `platformUrlInput()`. Static code passes `startUrls`, `urls`, `maxItems`, and `resultsLimit`. |
| Facebook | `https://fb.watch/...` | Yes by placeholder implication | Yes: Facebook | Yes: Facebook actor | Yes | `platformFromUrl()` recognizes `fb.watch`. Provider `platformFromText()` recognizes `facebook`, not explicitly `fb.watch`, so provider source may fall back to TikTok unless the URL also contains Facebook text elsewhere. |
| LinkedIn | `https://www.linkedin.com/posts/...` | Yes | Yes: LinkedIn | No default actor | Yes | Backend accepts and stores LinkedIn, but `sourceActorId(linkedin)` returns an empty default. Needs `APIFY_LINKEDIN_ACTOR_ID` or global `APIFY_SOCIAL_ACTOR_ID`; otherwise URL scan start fails. |
| LinkedIn | `https://www.linkedin.com/company/...` | Yes | Yes: LinkedIn | No default actor | Yes | Same actor configuration gap as LinkedIn post URLs. |
| X | `https://x.com/user/status/...` | Yes | Yes: X | No: provider falls back to TikTok | Yes | `platformFromUrl()` stores X, but `actorSourceFromUrl()` has no X branch and defaults to TikTok. `syncResearchScan()` also maps non-Instagram/YouTube/Facebook/LinkedIn to TikTok. X URL support is currently promised by UI but not truly routed. |
| Twitter | `https://twitter.com/user/status/...` | Yes by X support | Yes: X | No: provider falls back to TikTok | Yes | Same mismatch as X. |

## Schema Shape

All normalized research results are converted to `CompetitorResult`-compatible fields:
- `id`
- `workspaceId`
- `competitorId`
- `platform`
- `url`
- `title`
- `thumbnailUrl`
- `mediaUrl`
- `mediaType`
- `duration`
- `description`
- `views`
- `likes`
- `comments`
- `publishedAt`
- `capturedAt`

Static concerns:
- URL scans depend on actor-specific field names being normalized by `normalizeSocialItem()`. Unsupported actor schemas can produce empty result sets even if the scan starts.
- Keyword fallback fabricates estimated `views`, `likes`, and `comments` from Google search result order because ordinary search results do not expose social metrics.
- Platform can be mislabeled for YouTube URL scans because API scan creation stores YouTube URLs as TikTok.
- X/Twitter URL scans are not truly supported because provider source selection defaults them to TikTok.

## Findings

Works statically, assuming valid session cookie and healthy Apify token:
- Keyword: Instagram all/Reels/Posts.
- Keyword: TikTok all.
- Keyword: YouTube all.
- Keyword: Facebook all, subject to actor input compatibility.
- Keyword: LinkedIn all/articles through fallback or a configured LinkedIn actor.
- URL: Instagram, TikTok, Facebook with appropriate actor compatibility.

UI promises but backend cannot currently deliver cleanly:
- URL: YouTube watch/shorts are promised in the placeholder and provider can detect YouTube, but `scanResearchUrl` stores them as TikTok and `syncResearchScan` reconstructs source from that saved platform.
- URL: X/Twitter is promised in the placeholder and stored as X, but provider source selection has no X actor and defaults to TikTok.
- URL: LinkedIn is promised but has no default actor, so it requires explicit `APIFY_LINKEDIN_ACTOR_ID` or `APIFY_SOCIAL_ACTOR_ID`.

Not exposed by UI despite latent provider support:
- YouTube Shorts vs long-form keyword filtering.
- Facebook short-video, long-video, image, text, link, and article keyword filtering.
- Generic TikTok short-video keyword filtering.
- X keyword search.

## Recommended Live Testing Later

When `APIFY_API_TOKEN` and actor configuration are known healthy, live-test in this order:
1. Instagram keyword all/Reels/Posts, because the UI and backend mappings are explicit.
2. TikTok keyword all and URL video, because default actors are present.
3. YouTube keyword all, then fix the URL platform mismatch before live-testing YouTube URL scans further.
4. Facebook keyword all and URL scans, specifically validating the `scrapeforge/facebook-search-posts` input schema.
5. LinkedIn only after configuring `APIFY_LINKEDIN_ACTOR_ID` or confirming fallback-only behavior is acceptable.
6. X/Twitter only after adding a real provider route or removing X from the URL placeholder.
