# UX research and decisions — 2026-09-05

The references below informed interaction choices; CABUILD retains its own visual identity. Research used official product pages and help documentation, not authenticated competitor workspaces.

| Reference | Observed pattern | CABUILD application |
| --- | --- | --- |
| [Buffer Create](https://buffer.com/create) and [creating ideas](https://support.buffer.com/en-us/articles/creating-ideas-in-buffer-7gu7n0Hyyq) | Persistent creation entry and a reusable collection of ideas that can become posts. | Create and My Contents are reachable through the shared Normal Content menu; source results feed one shared editor. |
| [Notion page styling](https://www.notion.com/en-gb/help/customize-and-style-your-content) and [layouts](https://www.notion.com/en-gb/help/layouts) | Page-width choices and reusable page layouts. | Use one centered 1080px maximum canvas with the same gutters, avoiding per-page width switches. This also keeps the page order recognizable on mobile. |
| [Ghost editor cards](https://ghost.org/help/cards/) | Media and structured content inserted within the editing surface. | Research creation and source/output previews expand inline, with explicit close/back controls. |
| [Descript scenes](https://help.descript.com/hc/en-us/articles/10119710379917-Working-with-scenes-and-layouts) and [product tour](https://www.descript.com/tour) | Editing organized around script and scenes; users can bring existing material. | Drama supports direct scene prompts and editable clips without first generating a brief, story or image pack. |
| [Linear team pages](https://linear.app/docs/default-team-pages) | A stable navigation structure with contextual landing pages. | Keep workspace context and destination labels visible; preserve direct links and active states. |
| [Later content calendar](https://later.com/social-media-content-calendar/) | A shared media library beside planning and output review. | Keep My Contents and Drama's reusable asset library easy to reach throughout the workflow. |

## Shared design rules

- The header, page context and main canvas share responsive horizontal gutters. All primary content panels use the same available width.
- Section navigation has visible labels and wraps; it does not expand over content on hover. Workspace and Credits menus open on desktop hover and on tap/click, with Escape/outside-click dismissal. Pointer bridges are limited to hover-capable fine-pointer devices.
- Home stays left; workspace, Credits and account controls stay right. Create and My Contents remain inside the Normal Content menu. Icon-only compact controls retain accessible names.
- Primary actions use the same dark button treatment; secondary actions use quiet/outlined controls. Inputs and keyboard focus remain visible.
- Optional reference controls collapse inline. Research prompt review displays content instead of internal JSON/debug labels.
- Drama requires only the input needed for the requested action. Earlier stages and optional images do not act as completion gates.
- Drama's stylesheet is scoped to its root so client-side navigation cannot restyle Normal Content.
- Mobile keeps the same content order, paired navigation labels and consistent side gutters, with single-column forms when needed.

## Acceptance principles

Inspect every routed page and Normal Content destination at desktop and mobile widths; check active links, matching content edges, document/nested overflow, keyboard focus and browser errors. Test direct stage 5 with empty storage, input validation, source reuse and per-stage draft recovery without paid provider work. Preserve ownership and real generation/publishing safeguards.


## Home styling extended to all pages

`components/page-intro.tsx` supplies compact illustrated page introductions, retaining existing History, filters, counts and action controls. `app/workspace-theme.css` carries Home's cream surfaces, sage Normal Content accents, lilac Drama accents, rounded cards and shared typography into forms, results, libraries, admin and authentication. Decorative artwork is interface illustration, not a generated result or a measured chart. Error/success colors and disabled states retain their meanings.

The centered 1080px canvas and responsive gutters remain unchanged. Normal Content, all five Drama stages, Production Info, Asset Library, all five admin tabs, sign-in, registration, verification, access-denied and not-found states share the visual system. Analyze explicitly labels its demonstration forecast.

## 2026-09-06 — Choosing a saved Creative Brief for Story Studio

- [Notion search](https://www.notion.com/help/search) documents searching titles/content and sorting/filtering results. CABUILD applies text search and newest-first ordering, with Favorites as its existing personal-library filter.
- [Salt selectable-card guidance](https://www.saltdesignsystem.com/salt/patterns/selectable-card) supports rich descriptive cards and radio-style single selection. CABUILD uses a native radio group in a themed dialog, showing a brief preview, episode format, language and saved date before explicit confirmation. An optional full-text preview supports longer briefs without crowding each card.
- These references inform interaction patterns; the cream/lilac surfaces, artwork, typography, buttons and shortened dialog retain the existing Creative Brief style. Search/filter changes clear the candidate so hidden results cannot be selected accidentally. Editing the chosen copy affects the new Story Studio only.

## 2026-09-07 — Simplified brief selection and Story Studio controls

The saved-brief picker now shows available titles only, retaining search, Favorites and explicit radio selection. Preview text, metadata and full-brief details were removed following the updated product request. The selected-source area has one Change Brief action. Story Studio extends the existing lilac form system with larger episode editors, model radio cards, a count slider, individually collapsible scene/image prompts and responsive asset cards with stacked actions. Cost tooltips stay within their controls, including on mobile and tablet.

## 2026-09-09 - Compact Drama workspaces

Story Studio repeated every episode in its story editor and prompt section, then rendered the entire asset gallery below. Combine each episode's editable storyline and prompts in one selected panel; separate Series, Episodes and Images without reducing text size. Keep per-episode prompt readiness and per-image generating/ready/failed states visible on inactive tabs. Apply the same pattern to generation-job episodes/clips and creation/result lists. Reference the shared Creative Brief card for lilac surfaces/large titles and Asset Library category filters for grouping.

External references: [W3C APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) specifies labelled tab/panel relationships, arrow navigation and automatic activation when panel display is immediate. [Atlassian Tabs](https://atlassian.design/components/tabs) groups related content on the same page. Use local automatic tabs with wrapping at narrow widths, visible text statuses, and stable parent-owned edits/jobs; no automatic provider action or selection change on background progress. Keep model and bulk generation settings in a compact disclosure with the selected model visible in its summary.

## Content Creator alignment - 2026-09-13

Reference audit used the current in-repository Drama Studio, Creative Brief, Story Studio, Generate & Edit, Production Info and Asset Library rather than a separate design source. Reused the shared PageIntro's lilac treatment, centered 1080px canvas, full-width moving tab indicator, Asset Library's standalone utility button, cream cards with lilac borders, purple section headings and selected controls, and readable mobile form sizing. Content Creator keeps its existing semantic steps, status colors, saved sources and generation flow. Its old duplicate context bar is removed so the header-to-navigation-to-page hierarchy matches Drama.

Account and Settings are global destinations. Logs remains a workspace operation but sits outside the creative workflow tabs. Neutral credit colors separate the financial readout from selected purple content controls. The account menu now supports hover transfer, pointer-leave dismissal, click/touch, keyboard and Escape, using the existing header panel controller.

## 2026-09-13 - Preserve Content Creator green palette

User clarification: keep Content Creator in its original sage/green color scheme. Restored green introductions, cards, headings, selections, buttons, focus treatments and the standalone Logs button while retaining the new layout and navigation. Drama Studio keeps its lilac theme; credits remain neutral gray. Account and Settings follow the green frontend palette. Existing focused UAT now distinguishes the two palettes while verifying shared layout and unchanged navigation.
