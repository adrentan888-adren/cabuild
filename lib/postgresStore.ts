import { Pool, PoolClient } from "pg";
import type { Database } from "./types";

const stateId = process.env.POSTGRES_STATE_ID || "default";
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required when DATA_STORE_PROVIDER=postgres.");
  return url;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.POSTGRES_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

export function postgresEnabled() {
  return process.env.DATA_STORE_PROVIDER === "postgres";
}

async function ensureSchema(client?: PoolClient) {
  const run = async (runner: Pool | PoolClient) => {
    await runner.query(`
      create table if not exists ca_app_state (
        id text primary key,
        data jsonb not null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await runner.query(`
      create table if not exists ca_app_state_backups (
        id bigserial primary key,
        state_id text not null,
        data jsonb not null,
        reason text not null default 'manual',
        created_at timestamptz not null default now()
      )
    `);
  };

  if (client) {
    await run(client);
    return;
  }
  if (!schemaReady) schemaReady = run(getPool());
  await schemaReady;
}

export async function readPostgresDb(seed: () => Database, normalize: (db: Database) => Database) {
  await ensureSchema();
  const res = await getPool().query("select data from ca_app_state where id = $1", [stateId]);
  if (!res.rowCount) {
    const db = normalize(seed());
    await writePostgresDb(db);
    return db;
  }
  return normalize(res.rows[0].data as Database);
}

export async function writePostgresDb(db: Database) {
  await ensureSchema();
  await getPool().query(
    `insert into ca_app_state (id, data, version, updated_at)
     values ($1, $2::jsonb, 1, now())
     on conflict (id)
     do update set data = excluded.data, version = ca_app_state.version + 1, updated_at = now()`,
    [stateId, JSON.stringify(db)]
  );
}

export async function mutatePostgresDb<T>(seed: () => Database, normalize: (db: Database) => Database, fn: (db: Database) => T | Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await ensureSchema(client);
    const res = await client.query("select data from ca_app_state where id = $1 for update", [stateId]);
    let db: Database;
    if (!res.rowCount) {
      db = normalize(seed());
      await client.query("insert into ca_app_state (id, data) values ($1, $2::jsonb)", [stateId, JSON.stringify(db)]);
    } else {
      db = normalize(res.rows[0].data as Database);
    }
    const result = await fn(db);
    const normalized = normalize(db);
    await client.query(
      "update ca_app_state set data = $2::jsonb, version = version + 1, updated_at = now() where id = $1",
      [stateId, JSON.stringify(normalized)]
    );
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function backupPostgresDb(reason = "manual") {
  await ensureSchema();
  await getPool().query(
    `insert into ca_app_state_backups (state_id, data, reason)
     select id, data, $2 from ca_app_state where id = $1`,
    [stateId, reason]
  );
}
