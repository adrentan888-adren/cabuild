import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const input = process.argv[2] || "data/app.json";
const stateId = process.env.POSTGRES_STATE_ID || "default";

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

async function main() {
  const data = JSON.parse(await readFile(input, "utf8"));
  await pool.query(`
    create table if not exists ca_app_state (
      id text primary key,
      data jsonb not null,
      version integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists ca_app_state_backups (
      id bigserial primary key,
      state_id text not null,
      data jsonb not null,
      reason text not null default 'manual',
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(
    `insert into ca_app_state_backups (state_id, data, reason)
     select id, data, 'pre-import' from ca_app_state where id = $1`,
    [stateId]
  );
  await pool.query(
    `insert into ca_app_state (id, data, version, updated_at)
     values ($1, $2::jsonb, 1, now())
     on conflict (id)
     do update set data = excluded.data, version = ca_app_state.version + 1, updated_at = now()`,
    [stateId, JSON.stringify(data)]
  );
  console.log(`Imported ${input} into ca_app_state/${stateId}.`);
}

main().finally(() => pool.end());
