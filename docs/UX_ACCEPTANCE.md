# UX acceptance — 2026-09-05

## Scope and reproducible checks

- `npm run lint` and `npm run build`: required release gates. Existing React effect dependency and Next image-optimization warnings remain; no new warning is accepted as a substitute for a successful build.
- Local browser target: the production build on `http://localhost:3100`, using the local prefilled demo account.
- No-spend behavioral regression: `node tools/uat/ux-flows.cjs`. Requires Playwright and installed Chrome. Set `PLAYWRIGHT_MODULE` to the absolute installed Playwright module if it is outside the repository. The script is deliberately fixed to localhost; social actions and video-generation requests are intercepted before login.
- Screenshot/geometry audit: Home; Persona; Research; Create Content; My Contents; Automation; Social Audit; Analyze; Logs; Settings; Drama stages 1–5; Production Info; Asset Library; Administration. Tested at 1440×900 and 390×900. The audit measures document width and the rendered canvas edges, and captures each page.
- Behavioral checks: skip from an empty Creative Brief straight to video; no automatic provider calls; empty prompt, out-of-range duration, empty added scene; selected-scene submission; refresh/resume of owner-scoped draft; no false earlier-stage completion; failure retains input; Back returns to Creative Brief; exact Research source reaches the inline editor without a modal or new tab.

## Primary-agent results

- All 18 audited destinations have no document overflow at desktop and mobile widths after repairing the admin table layout.
- Social/Drama content edges measure 180px each at 1440px viewport width (1080px canvas), and 16px each at 390px (358px canvas). Admin content uses the same inner edges and padding.
- Screenshot contact sheets were visually reviewed for all audited destinations. Additional mobile corrections stack Persona/Automation hero copy and actions, pair Research metrics, and preserve the final-output link.
- Browser page exceptions: none in the page audit and behavioral regression.
- Direct-video validation, draft persistence/resume, failed submission retention, Browser Back, and inline research editing passed with intercepted provider requests.
- Retained checks for actual asset ownership, provider errors, generation confirmation and server validation. No paid generation, social publishing, email, billing, or production-content modification is part of these tests.

## Independent UAT and release

Independent UAT: **Pass** on the final production build. The reviewer checked 104 route, admin-tab and viewport combinations at 390, 768, 1024 and 1440px, with no document overflow, clipped visible controls, JavaScript exceptions or server 5xx responses. Focused checks passed for direct manual Drama stages 2–5, empty-input validation, incomplete-asset reuse, owner-scoped draft recovery, failure retention, Research source isolation, keyboard focus, review/back field retention, failed-queue retry and Escape behavior. All reported draft-source and tablet-layout defects were resolved. Unauthenticated `/api/app` returned 401. Generation requests were intercepted; no paid services or publishing were exercised. Production workflow and smoke-test evidence are recorded in the persistent CABUILD project log after deployment.

## Known product boundaries

- Drama draft/library metadata is browser-local and owner-scoped; server-backed My Contents retains generation jobs and asset handoff. This change does not implement cross-device draft synchronization.
- Real paid provider success, live publishing, email delivery and billing are not verified by intercepted UI tests.
- Some older analytics indicators and unexposed backend modules remain prototype functionality; see the capability guide instead of treating the PRD as a list of shipped screens.

## Header and welcome refinement — 2026-09-05

- Removed duplicate top-level Create/My Contents links. Home stays left; workspace, credit and account controls align right, with the workspace controls on a right-aligned second row on phones.
- Workspace and Credits hover menus preserve direct page access, delayed pointer-leave dismissal, tap/click toggles, keyboard activation, Escape focus restoration and outside dismissal. Normal Content includes Settings.
- Home has original SVG concept graphics, two workspace introductions, a flexible four-stage pipeline and recent completed outputs. Empty-state illustrations are labeled examples; they are not claimed as generated work. Linked assets/queue records are deduplicated for the showcase.
- `npm run lint` and `npm run build` passed with existing warnings only. Both `tools/uat/header-welcome.cjs` and the prior `tools/uat/ux-flows.cjs` passed on the final local production build.
- Header/welcome browser checks cover 390, 768 and 1440px widths, hover traversal, balance display, keyboard/Escape, menu bounds, absence of top shortcuts, empty-state labels and real-result deduplication. No provider mutations were attempted and no page exceptions occurred.
- Desktop/mobile screenshots of hero, pipeline and showcase were visually reviewed. Home navigation resets the actual main scroll container.
- Independent UAT and production release results for this refinement are recorded in the persistent CABUILD project log.
- Independent UAT identified and prompted fixes for linked text captions, fresh hover after Escape, slow pointer traversal across header padding, 320px admin sizing, and Home anchor cleanup. Both local regression suites passed again after the fixes; final independent verdict and production evidence are recorded in the project log.
