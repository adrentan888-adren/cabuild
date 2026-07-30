# Sanitized API and security checks

Captured against current staging on 2026-07-30. No paid provider or publishing
operation was invoked.

## Availability and authentication

- Frontend root returned HTTP 200.
- Admin unauthenticated access redirected to the login page.
- API `/api/app`, `/api/social`, and `/api/admin/users` rejected unauthenticated
  requests with HTTP 401.
- API `/healthz` returned HTTP 404.
- API `/health` returned HTTP 404.
- Logout invalidated the browser session and a protected admin revisit returned
  to the login page.

## Authentication validation

- Known-email wrong-password and unknown-email login attempts returned the same
  generic HTTP 401 response.
- Short-password, password-mismatch, malformed verification-code, and empty
  resend requests were rejected without sending email.
- A duplicate mixed-case/spaced verified email was rejected with HTTP 409.
- A valid mixed-case/spaced email login succeeded, confirming normalization.

## CORS

- Allowed staging frontend origin: preflight returned HTTP 204 with the matching
  access-control origin and credentials policy.
- Untrusted origin: preflight returned HTTP 204 without an access-control allow
  origin header.

## Public media route

- Random, malformed, and traversal-style tokens returned HTTP 404.
- Static inspection found that public media tokens are reversible base64url
  encodings of storage keys and are not signed, expiring, or authorized against
  a requesting workspace.
- The route accepts decoded keys under `uploads/` and `generated/`. Possession or
  derivation of a valid key is therefore sufficient to retrieve media.

## Staging isolation

- Staging has its own Cloud SQL instance and storage bucket.
- Staging and production share the application/session secret, provider secret
  references, service identity, and automation secret.
- A staging scheduler targets the staging API, but shared credentials mean a
  staging action can still consume or affect production provider accounts.

All values in this evidence file are sanitized; no secret values are recorded.
