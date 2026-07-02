import { writeFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const output = process.argv[2] || `postgres-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
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
  const res = await pool.query("select data from ca_app_state where id = $1", [stateId]);
  if (!res.rowCount) throw new Error(`No ca_app_state row found for ${stateId}.`);
  await writeFile(output, JSON.stringify(res.rows[0].data, null, 2));
  console.log(`Exported ca_app_state/${stateId} to ${output}.`);
}

main().finally(() => pool.end());
