---
name: cabuild-website-delivery
description: Implement, repair, validate, UAT, and ship CABUILD website changes from research and AI content creation through script, video, media, automation, upload, and publishing workflows. Use for CABUILD UI, API, content-generation, media, automation, deployment, or production-fix work; do not use for unrelated repositories or advice-only requests.
---

# CABUILD Website Delivery

Ship CABUILD changes from the latest `main` only after the code compiles, the affected website journeys are accessible, independent UAT passes, deployment succeeds, and production is verified.

## Product outcome

CABUILD is an AI-assisted content operations platform. Preserve a coherent path from social research and brand/persona context through script and asset generation, video and media handling, review, automation, upload, and social publishing. Keep long-running provider work asynchronous, recoverable, owner-scoped, and visible in My Contents.

Use the repository UI as the visual source of truth and the product requirements as the behavioral authority. Preserve user, persona, research, generation, media, automation, billing, and publishing history across upgrades.

## Start from the latest Git state

Do not inspect or edit implementation code until this synchronization check is complete:

1. Confirm the checkout belongs to `https://github.com/adrentan888-adren/cabuild`, GitHub authentication works, and `git status` has been inspected.
2. Fetch `origin/main` and compare it with the current branch and `HEAD`.
3. When the worktree is clean, switch to `main` and run `git pull --ff-only origin main`.
4. When the worktree is dirty, on another intentional branch, or has diverged, preserve every pre-existing change. Fetch first, then isolate or reconcile the work safely before proceeding. Never reset, overwrite, discard, or silently mix unrelated work merely to make the pull succeed.
5. Read the relevant sections of `PROJECT_HANDOFF.md`, the PRD at `C:\Codex\MarkdownFiles\CA\CABUILD_PRODUCT_REQUIREMENTS_DOCUMENT_2026-08-24.docx` when available, and the persistent project log at `C:\Codex\MarkdownFiles\CA\CA_BUILD_Info.md` when available.

Never force-push. Treat `origin/main` as the implementation source of truth and stop for a consequential user choice if safe reconciliation is impossible.

## Define and implement the change

- Translate the request into observable acceptance criteria covering the affected user journey, failure states, ownership, persistence, and responsive behavior.
- Inspect established code patterns before editing. Keep the change scoped and preserve secrets, environment configuration, user data, generated assets, and unrelated work.
- Keep shared Create Content, Research, Automation, My Contents, media, upload, and publishing schemas aligned when a change crosses those surfaces.
- Update `PROJECT_HANDOFF.md` for a material feature, architecture, migration, deployment, or operational change.
- Never commit credentials, `.env` files, provider payloads containing secrets, production data, or generated secret material.

## Compile, run, and repair until healthy

After implementation, run the complete local gate:

1. Use `npm ci` when dependencies are missing or `package-lock.json` changed.
2. Run `npm run lint`.
3. Run `npm run build` and investigate warnings that imply runtime risk.
4. Run focused tests and API checks for the changed behavior.
5. Start the built application and verify that affected routes return the expected HTTP responses and that the primary website is usable in a browser without relevant console or network errors.
6. Exercise both desktop and mobile layouts for UI changes, checking keyboard access, visible focus, labels, contrast, overlap, clipping, and nested horizontal scrolling.

Fix every code-owned failure and repeat the affected checks, then repeat the complete gate before release. Continue while each pass produces a concrete diagnosis or repair. If the same failure remains unchanged after three evidence-backed attempts, or the blocker requires unavailable credentials, destructive data changes, paid provider use, or an external service recovery, stop and report it as `Blocked` rather than looping indefinitely or claiming success.

Do not treat a successful build alone as proof that the website is accessible.

## Require independent UAT

After local checks pass, spawn one dedicated read-only UAT agent when delegation is available. Give it the user request, acceptance criteria, relevant PRD context, final diff, local URL, and any safe test account. Do not give it the intended verdict.

The UAT agent must not edit files, commit, push, deploy, publish content, delete data, create paid provider jobs, change billing, or otherwise mutate production. It should independently:

- Run relevant automated checks and exercise the primary affected journeys.
- Cover negative cases, authentication and ownership boundaries, persistence and refresh behavior, regression risks, API behavior, and browser console/network errors.
- Check desktop and mobile UX for UI work.
- Report `Pass`, `Fail`, or `Blocked` with reproducible evidence, affected surfaces, and prioritized defects.

Fix code-owned UAT defects and send the same agent a focused retest. Do not push until it reports `Pass`. If delegation is unavailable, perform a separate local UAT pass and disclose that no independent agent was available.

Use free/no-spend tests by default. Paid generation, real email, social publishing, live billing, destructive changes, and tests that consume meaningful external quota require explicit user authorization immediately before execution.

## Commit, push, deploy, and verify

Only after the full local gate and UAT pass:

1. Review `git diff` and confirm that only intended files will be committed.
2. Fetch `origin/main` again. If it advanced, integrate safely and rerun affected checks plus the complete release gate.
3. Commit only the intended files on `main` with a concise message.
4. Push with `git push origin main` and never use a force push.
5. Watch the GitHub Actions workflow for the pushed commit until it finishes. A push is not a successful release.
6. If CI or deployment fails for a code-owned reason, inspect the logs, fix it, rerun local validation and UAT as appropriate, commit, push, and watch again.
7. After deployment succeeds, safely smoke-test the production frontend, admin, and API surfaces affected by the change. Use the UAT agent for a read-only production retest when appropriate.
8. If production exposes a code-owned regression, repeat the repair, validation, UAT, push, deployment, and verification loop.

Canonical production surfaces:

- Frontend: `https://contentagent-social-mkhae4sjlq-as.a.run.app`
- Admin: `https://contentagent-admin-mkhae4sjlq-as.a.run.app`
- API: `https://contentagent-api-mkhae4sjlq-as.a.run.app`

Record the completed outcome, commit hash, checks, UAT result, workflow result, and verified production surfaces in `C:\Codex\MarkdownFiles\CA\CA_BUILD_Info.md` when available. Do not create an empty commit or deployment when no repository file changed.

## Completion report and UX recommendations

Report the user-visible outcome first, then the commit, validation results, UAT verdict, workflow status, verified URLs, and any genuine limitation.

End with one to three prioritized UX recommendations grounded in the PRD, observed website behavior, UAT evidence, or the final diff. Favor improvements that shorten time to a reviewable asset, clarify asynchronous AI progress and recovery, prevent accidental spend or publishing, reduce cross-module drift, improve accessibility, or make the research-to-generation-to-publishing path easier to understand. Keep recommendations separate from required fixes and do not implement them without authorization.
