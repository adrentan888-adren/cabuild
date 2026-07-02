# Phase 3 Postgres Persistence

Phase 3 currently uses a Postgres-backed app-state table while preserving the existing `readDb` / `mutateDb` / `writeDb` application contract.

## Runtime Env

Set these variables to enable Postgres:

```bash
DATA_STORE_PROVIDER=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME
POSTGRES_STATE_ID=staging
POSTGRES_SSL=true
```

`POSTGRES_STATE_ID` can be `staging`, `production`, or another environment-specific name.

## Tables

The app creates these tables automatically:

- `ca_app_state`: one JSONB app-state row per `POSTGRES_STATE_ID`.
- `ca_app_state_backups`: point-in-time JSONB backups.

This is the first safe migration step. It gives durable Postgres persistence without rewriting every feature at once. Normalized relational tables can be added later after the behavior is stable.

## Import Existing JSON

```bash
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
$env:DATA_STORE_PROVIDER="postgres"
$env:POSTGRES_STATE_ID="staging"
node tools/postgres/import-json-to-postgres.mjs data/app.json
```

The import script creates a `pre-import` backup if a row already exists.

## Export Backup JSON

```bash
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
$env:POSTGRES_STATE_ID="staging"
node tools/postgres/export-postgres-json.mjs backups/staging-export.json
```

## Create DB Backup

```bash
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
$env:POSTGRES_STATE_ID="staging"
node tools/postgres/backup-postgres.mjs before-release
```

## Restore DB Backup

```bash
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
$env:POSTGRES_STATE_ID="staging"
node tools/postgres/restore-postgres-backup.mjs 123
```

## Staging Deployment

Do not set `DATA_STORE_PROVIDER=postgres` on Cloud Run until `DATABASE_URL` is available as a secret and the current app state has been imported.
