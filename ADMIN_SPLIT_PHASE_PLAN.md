# Admin Split And Multi-User Rollout Plan

Last updated: 2026-07-02

## Goal

Move the current combined ContentAgent app into a safer structure:

- Frontend app URL for normal users.
- Separate Admin/backend URL for operations, prompt management, logs, and user management.
- Eventually support multiple users and workspaces cleanly.

Do not build all phases at once. Each phase must pass its test gate before continuing.

## Branching Strategy

Use a staging branch for this rollout.

Recommended branch:

```bash
git checkout main
git pull origin main
git checkout -b staging/admin-split
git push -u origin staging/admin-split
```

All phase work should happen on `staging/admin-split` first. Only merge to `main` after a phase passes local tests and user acceptance testing.

Recommended tags:

```bash
git tag before-admin-split
git push origin before-admin-split
```

After each phase passes:

```bash
git tag phase-1-admin-split-passed
git push origin phase-1-admin-split-passed
```

For later phases, use:

- `phase-2-user-management-passed`
- `phase-3-postgres-passed`
- `phase-4-api-split-passed`

## Why Staging Branch Is Better

This rollout touches navigation, auth, admin permissions, data isolation, and deployment. Building on a staging branch reduces risk because:

- `main` remains deployable.
- Cloud Run/GitHub deployment from `main` is not affected by unfinished work.
- We can test phase by phase without breaking the live frontend.
- Rollback is simple: keep using `main`, or reset the staging branch.

Use `main` only for stable, tested phase releases.

## Recommended Rollout

### Phase 1: Separate Admin Surface

Scope:

- Move current `Backend` tab content into a dedicated `/admin` route.
- Remove or hide the `Backend` tab from the normal frontend sidebar.
- Add admin-only access guard.
- Keep the same repo, same backend API routes, and same data store for now.
- Keep current frontend features unchanged.

Suggested implementation:

- Add `app/admin/page.tsx` or equivalent admin route.
- Reuse existing admin/backend UI components where practical.
- Add role/admin check before rendering admin UI.
- Keep frontend at `/`.

Test gate:

- Frontend no longer shows `Backend` tab.
- `/admin` loads only for admin users.
- Normal frontend user cannot access `/admin`.
- Research search still works.
- Create Content still works.
- My Contents still works.
- Persona save/autofill still works.
- Admin prompt editor still saves and affects generation prompts.
- Debug Logs still record actions.
- `npm run build` passes.

Move to Phase 2 only if:

- No existing frontend feature broke.
- Admin-only access works.
- Prompt changes from admin still affect frontend generation.

### Phase 2: Admin User Management

Scope:

- Add backend GUI to manage users.
- Replace reliance on simple `admin/admin` style admin access.
- Add roles and basic user lifecycle controls.

Suggested features:

- User list.
- Create user.
- Disable user.
- Reset password.
- Assign role: `super_admin`, `admin`, `user`.
- Assign workspace.

Test gate:

- Admin can create a new user.
- New user can log in.
- Disabled user cannot log in.
- Password reset works.
- `admin` can access `/admin`.
- `user` cannot access `/admin`.
- User A cannot see User B's Persona, Research, My Contents, or logs.
- Existing demo user still works.
- `npm run build` passes.

Move to Phase 3 only if:

- Login and role rules are correct.
- User data separation works.
- Existing app flows still pass.

### Phase 3: Postgres Persistence

Scope:

- Replace JSON/GCS-style persistence with Postgres for multi-user reliability.
- Recommended options: Cloud SQL Postgres on GCP, Neon, or Supabase.

Suggested tables:

- `users`
- `workspaces`
- `workspace_members`
- `persona_profiles`
- `research_runs`
- `research_results`
- `assets`
- `publish_queue`
- `prompt_templates`
- `api_keys`
- `debug_logs`
- `connected_accounts`

Test gate:

- Existing data migrates correctly.
- Users persist after server restart.
- Research history persists after redeploy.
- Generated assets and My Contents persist after redeploy.
- Persona persists after redeploy.
- Prompt templates persist after redeploy.
- Logs persist after redeploy.
- Two users can use the app at the same time without overwriting each other.
- User A cannot see User B data.
- Database backup works.
- Restore to test DB works.
- App load time remains acceptable.
- `npm run build` passes.

Move to Phase 4 only if:

- Data survives restart/redeploy.
- No cross-user leakage exists.
- Backup and restore are verified.

### Phase 4: Separate API Service

Scope:

- Split into separate deployable services:
  - Frontend app.
  - Admin app.
  - API service.

This is not urgent. Do it only after admin and multi-user persistence are stable.

Test gate:

- Frontend talks to API URL successfully.
- Admin talks to API URL successfully.
- Auth works across domains.
- CORS allows only approved frontend/admin domains.
- Random domains are blocked.
- Login works.
- Research works.
- Create Content works.
- My Contents works.
- Persona works.
- Admin user management works.
- Logs show correct user/workspace.
- Provider secrets never appear client-side.
- `npm run build` passes for all apps/services.

Move forward only if:

- Frontend and admin work only through the API.
- CORS and auth are correct.
- No provider token appears in browser output.

## Deployment Strategy

For Phase 1 and Phase 2, keep one repo and one Next.js codebase.

Preferred URLs later:

- Frontend: `https://app.yourdomain.com`
- Admin: `https://admin.yourdomain.com`
- API later: `https://api.yourdomain.com`

Without custom domain:

- Frontend: existing Cloud Run URL.
- Admin: separate Cloud Run service URL.

Deploy staging before production when possible:

- `contentagent-social-staging`
- `contentagent-admin-staging`

Then merge to `main` and deploy production only after the phase gate passes.

## Operating Rule For Future Sessions

Before starting a phase:

1. Confirm current branch.
2. Confirm clean working tree.
3. Create or update staging branch.
4. Record planned work in this file or `PROJECT_HANDOFF.md`.
5. Implement only the current phase.
6. Run the phase test gate.
7. Report pass/fail clearly.
8. Push staging branch.
9. Merge to `main` only after user approval.

