import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const backupId = process.argv[2];
const stateId = process.env.POSTGRES_STATE_ID || "default";

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!backupId) {
  console.error("Usage: node tools/postgres/restore-postgres-backup.mjs <backup-id>");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

async function main() {
  const backup = await pool.query("select data from ca_app_state_backups where id = $1 and state_id = $2", [backupId, stateId]);
  if (!backup.rowCount) throw new Error(`Backup ${backupId} not found for ${stateId}.`);
  await pool.query(
    `insert into ca_app_state (id, data, version, updated_at)
     values ($1, $2::jsonb, 1, now())
     on conflict (id)
     do update set data = excluded.data, version = ca_app_state.version + 1, updated_at = now()`,
    [stateId, JSON.stringify(backup.rows[0].data)]
  );
  console.log(`Restored backup ${backupId} into ca_app_state/${stateId}.`);
}

main().finally(() => pool.end());
