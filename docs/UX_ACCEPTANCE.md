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


## Application-wide Home visual system — 2026-09-05

- Primary production-build audit: 104 page/tab/viewport combinations at 1440, 768, 390 and 320px, covering public auth/not-found screens, Home, all nine Normal destinations, five Drama stages, both Drama libraries and all five admin tabs. Unique illustrated intros on functional pages, in-bounds controls and no document overflow passed. Desktop/mobile screenshot contact sheets were reviewed.
- Existing header/welcome/touch and Drama/Research workflow regressions passed. The old .step-hero heading locator was updated to the shared .page-intro heading; its Back-navigation behavior assertion remains.
- Commands: npm run lint; npm run build; node tools/uat/all-pages-style.cjs; node tools/uat/header-welcome.cjs; node tools/uat/ux-flows.cjs. Set PLAYWRIGHT_MODULE when using the bundled runtime. Provider actions are intercepted and no publishing or paid generation is part of the checks.
- Independent all-page/editor UAT and live release evidence are recorded in the persistent project log.

- Independent review caught the Research History popup extending beyond the viewport after the hero replacement. The menu now anchors to the left and clamps to its container; the responsive regression suite opens it at every tested width. Muted/faint text token checks exceed 4.5:1 against their intended light surfaces.

- Final independent local verdict: PASS. In addition to the primary 104 checks, the dedicated agent exercised 33 populated editor/builder/result/admin states at 320/390/1440px, Research review/back/failed-queue recovery, Drama skip/manual/draft recovery and populated History menus at all four widths with actual row hit testing. No page exceptions, clipped dynamic controls or actual provider mutations were observed.

## Drama Studio brief refinement — 2026-09-06

- New Creative Brief removes the right-side director/help cards and global start/reference panels. Larger working-title and story inputs, an optional collapsed seed generator below them, and visible format/guardrail/model controls are rendered at 320/390/768/1440px without document overflow.
- Focused browser checks verify seed prompt and continuity request payloads, selected model, browser draft refresh, generation failure retention, 15s success/30s red failure timing and X dismissal. Provider requests are intercepted; no paid generation is asserted.
- Shared page tabs fill each row with a moving active indicator. Asset Library is directly accessible in the Drama tab row and a separate desktop hover-menu column; narrow layouts stack the menu columns.
- Shared notices reserve their measured height outside the scrolling work area. This keeps the final Generate action clear while notices are visible.
- Final local gates passed: lint (baseline warnings only), production build, tools/uat/drama-brief.cjs, tools/uat/ux-flows.cjs, tools/uat/header-welcome.cjs, and 104 checks in tools/uat/all-pages-style.cjs. The workflow test now verifies Back from creation to Generate & Edit library, then Back to Creative Brief.
- Independent UAT and production evidence are recorded in the persistent project log.

## Brief generation repair and control polish — 2026-09-06

- Episodes/duration use native keyboard-accessible ranges with all supported value marks; no duplicate radio/button choices. Purple title/premise and finished-brief generation controls are inside the first story section. The seed prompt remains an optional disclosure.
- Two-column format choices and balanced guardrail groups fill their cards; mobile layouts stack groups. Intro/form spacing and removal of the Strong seeds hint are verified.
- tools/uat/drama-brief.cjs now checks raw HTTP500 responses containing long plain-text errors, full message retention, input recovery, slider marks and successful finished-brief creation with an intercepted response.
- tools/uat/drama-stage-api.cjs executes the actual TypeScript stage handler with mocked session/key/provider boundaries: successful brief, complete nested provider error, non-JSON failure, malformed output,210s deadline/504 with no retry, store failure503, anonymous/missing-key401 and invalid-body400 all pass.
- tools/uat/drama-proxy.cjs launches the built frontend with APP_SURFACE=frontend and a local API fixture. Its real middleware rewrite returns a valid brief after32,028ms (one upstream request), beyond the former30-second cutoff. A separate diagnostic agent reproduced the original error at30,068ms and confirmed the240-second configuration succeeds.
- These tests create no paid jobs. No live provider success is claimed; the precise duration of the user's production request could not be read because local Cloud logging credentials/tooling were unavailable.

## Content Creator redesign - 2026-09-13

- All eight content pages share Drama introduction styling, card surfaces, purple hierarchy, responsive controls and the same centered canvas. Home and shared header use Content Creator. Existing routes remain valid.
- Seven workflow links; Settings and Logs are absent from tabs. Logs uses the same standalone button styling as Asset Library, indicates its active page and supports Back.
- Account hover menu contains Account, Settings and Log out only. Hover corridor, keyboard activation, Escape/focus, touch and menu viewport bounds are exercised. Account and Settings remain independently accessible without workflow tabs.
- Neutral credit amount/selection colors preserve existing balances, error handling and owner-scoped preference tests.
- Local acceptance: lint/build, 108 page/tab/viewport cases and focused creator/header/Drama checks, at 1440/768/390/320 where applicable. Browser fixtures intercept provider/content writes; real generation quality is outside this UI check.

## 2026-09-13 - Preserve Content Creator green palette

User clarification: keep Content Creator in its original sage/green color scheme. Restored green introductions, cards, headings, selections, buttons, focus treatments and the standalone Logs button while retaining the new layout and navigation. Drama Studio keeps its lilac theme; credits remain neutral gray. Account and Settings follow the green frontend palette. Existing focused UAT now distinguishes the two palettes while verifying shared layout and unchanged navigation.
