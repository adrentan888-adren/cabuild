# Website capabilities

Updated: 2026-09-05. This guide describes the routes and controls implemented in this repository. Provider-backed features require an authenticated account, a configured provider, and sufficient balance. A visible control does not imply a successful live provider test.

## Getting around

The Content Agent logo returns Home. The header offers Normal Content, Drama Studio, Create, My Contents, credits and account controls. Workspace menus open on click; section links remain visible inside each workspace. Settings is available in the account menu. Pages share a centered 1080px content canvas with responsive gutters; phone navigation wraps into two columns.

## Page and feature directory

| Page | Address | What you can do |
| --- | --- | --- |
| Home | `/` | Choose Normal Content or Drama Studio, see workflow introductions, content counts, activity and suggested next actions. |
| Persona | `/?view=persona` | Create or update the single active persona; describe voice, audience, topics and positioning; autofill from public profiles; upload or record reference audio; maintain logo, avatar and product images. |
| Research | `/?view=research` | Search by source URL or keyword; choose the source/platform and content filters; set minimum views; inspect saved scan history; sort results by views, likes or date; open original posts; create from an exact result in the inline editor. Scans run in the background and expose progress/errors. |
| Create Content | `/?view=create` | Generate video, image or text; edit prompt, caption and hashtags; choose a supported model, format and duration; select Persona references or upload one-off media; use AI assistance where offered. Generation hands off to My Contents. |
| My Contents | `/?view=publish` | Review generating, completed and failed outputs in time order; inspect model, duration, caption, hashtags and errors; preview source and output media inline; download assets. Provider jobs are automatically checked while this screen is active. |
| Automation | `/?view=automation` | Create scheduled content rules and source watchers; configure content type, cadence, platforms, review preference, references and spend controls; inspect saved rules and runs; pause, resume, run or delete rules. |
| Social Audit | `/?view=audit` | Connect social accounts, audit connected profiles, review performance signals, trends, content pillars, top posts and diagnostic recommendations. Auditing can invoke an external research provider. |
| Analyze | `/?view=analyse` | View published-post count and average opportunity gap score. The displayed engagement forecast is currently a fixed demonstration value, not a measured forecast. |
| Logs | `/?view=logs` | Inspect and filter operational/provider activity, job status and error details for diagnosis. |
| Settings | `/?view=settings` | Edit workspace name and brand/niche context; obtain a social-account connection link; open permitted admin controls. Account connection requires the external provider's authorization page. |
| Creative Brief | `/drama-studio?step=1` | Describe a story and production format, audience, language, pacing, tone and rating; optionally generate a creative seed or finished brief; save and review library records. Skip to video at any point. |
| Story Studio | `/drama-studio?step=2` | Supply your own brief or reuse saved work; generate and edit the season story, episode outlines, recurring characters, asset descriptions and scene prompts; reuse library images and generate selected assets. |
| Visual Assets | `/drama-studio?step=3` | Legacy/direct stage for generating a visual asset pack from saved work or your own story direction. |
| Scene Prompts | `/drama-studio?step=4` | Legacy/direct stage for generating editable scene prompts from saved work or your own story direction. |
| Generate & Edit | `/drama-studio?step=5` | Start directly with your own scene prompts, or reuse Story Studio/scene-prompt records; add/remove clips; edit titles, prompts and 3–15-second durations; choose aspect ratio, model and applicable sound/quality settings; select only the clips to generate; inspect cost estimates; review, retry, download and combine available episode videos. Optional images do not block video creation. |
| Production Info | `/drama-studio/info` | Review saved production details, source records, generated scene outputs and combined episode deliverables. |
| Asset Library | `/drama-studio/assets` | Browse/search reusable character, venue and object images; inspect details; reuse assets in Story Studio; remove library entries with confirmation. |
| Sign in | `/login` | Authenticate an existing account and enter the workspace. |
| Register | `/register` | Register using email and matching password fields. |
| Verify email | `/verify-email` | Submit an email verification code or request another code. Requires the email service. |
| Administration | `/admin` | Authorized users manage users and roles, permission rules, generation prompt templates, encrypted provider-key overrides and system information. Server authorization still controls every operation. |

## Common journeys

### Social content

1. Save Persona context if useful; it is optional for starting content.
2. Research a topic or open Create directly.
3. Edit the content and references. Research opens its editor on the current page.
4. For research videos, review the refined human-readable prompt before starting video generation. Back to editing preserves your fields and references; a failed queue request leaves the editor available for retry.
5. Review progress and output in My Contents; preview and download there.
6. Configure connected accounts and automation when scheduling or automated publishing is wanted.

### Drama: guided or direct

- Guided: Creative Brief → Story Studio → Generate & Edit → Production Info.
- Direct: choose **Skip to video**, write a scene prompt, set duration/model, then generate selected clips. Earlier AI stages are optional.
- Existing work: choose a saved source in the stage editor. You can also paste a brief or story direction into later stages.
- Reference images: expand **Reference assets** when needed. Their absence or unfinished status does not require another generation step.
- Validation: a selected scene needs a non-empty prompt and a whole-number duration from 3 to 15 seconds. Skipping never marks earlier stages as completed. Browsing/skipping does not start a provider job.
- Unfinished input is saved separately per stage in this browser. Reopen the stage's create action to resume it. Manual edits to a library record use the explicit Save action.
- Generation results, references and combined-episode indexes use owner-scoped browser storage in Drama. Generated provider jobs/assets also hand off to the server-backed My Contents queue. Browser-only drafts and library metadata do not automatically sync between devices.

## Integrations and boundaries

- AI: Kie-backed chat, image and video model selection, asynchronous task submission/status, estimated credit display, error diagnosis and recovery controls.
- Research: platform/provider scans, normalized source results, saved history and connected-account audits.
- Publishing: Upload-Post connection and backend publishing actions; automation may publish according to its configured review/settings. My Contents is primarily a review/download queue; this build does not expose a manual Publish button on every row.
- Media: authenticated uploads, owned references, source/output previews, download endpoints, browser FFmpeg episode combination.
- Accounts: registration, verification, sign-in/out, owner isolation and role permissions.
- Operations: provider status, CA/provider balances, administrative prompt/key/user management, automation runner and Telegram webhook integration.
- Legacy backend actions also support content plans/briefs, opportunities, brand kits and UGC generation. They are not all exposed as top-level destinations in the current UI.
- Full billing/subscription purchase flows, the PRD's complete analytics system, and a standalone Video Template/Spokesperson screen are not present as current top-level routes. Do not treat PRD roadmap items as shipped capabilities.
- Destructive actions still use confirmation. External source posts and account authorization may require an external page. Routine creation and media review stay in the current workspace.

## Maintenance

Implementation sources: `app/page.tsx`, `components/global-header.tsx`, `components/drama/drama-studio.tsx`, `components/drama/workspace-page.tsx`, `app/admin/AdminPanel.tsx`, and `app/api/**`. Update this guide whenever a user-facing capability or persistence boundary changes.

See [UX research and decisions](UX_RESEARCH_AND_DECISIONS.md) and [UX acceptance checks](UX_ACCEPTANCE.md).
