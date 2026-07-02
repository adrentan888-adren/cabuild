import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const reason = process.argv[2] || "manual";
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
  await pool.query(`
    create table if not exists ca_app_state_backups (
      id bigserial primary key,
      state_id text not null,
      data jsonb not null,
      reason text not null default 'manual',
      created_at timestamptz not null default now()
    )
  `);
  const res = await pool.query(
    `insert into ca_app_state_backups (state_id, data, reason)
     select id, data, $2 from ca_app_state where id = $1
     returning id, created_at`,
    [stateId, reason]
  );
  if (!res.rowCount) throw new Error(`No ca_app_state row found for ${stateId}.`);
  console.log(`Backup ${res.rows[0].id} created at ${res.rows[0].created_at}.`);
}

main().finally(() => pool.end());
