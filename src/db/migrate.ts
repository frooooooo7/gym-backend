import { getPool } from "./pool.js";

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    name: "001_create_users",
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email         TEXT        UNIQUE NOT NULL,
        password_hash TEXT        NOT NULL,
        first_name    TEXT        NOT NULL,
        last_name     TEXT        NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE TRIGGER users_set_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `,
  },
];

const ADVISORY_LOCK_ID = 3_742_116_919;

export const runMigrations = async (): Promise<void> => {
  const pool = getPool();
  if (!pool) {
    console.warn("[migrate] DATABASE_URL not set — skipping migrations");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name   TEXT        NOT NULL UNIQUE,
        run_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const migration of MIGRATIONS) {
      const { rows } = await client.query(
        "SELECT id FROM _migrations WHERE name = $1",
        [migration.name],
      );
      if (rows.length > 0) continue;

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
          migration.name,
        ]);
        await client.query("COMMIT");
        console.log(`[migrate] applied ${migration.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("[migrate] up to date");
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
    } catch {
      /* already unlocked */
    }
    client.release();
  }
};

if (process.argv[1]?.includes("migrate")) {
  const pool = getPool();
  runMigrations()
    .catch((err) => {
      console.error("[migrate] error", err);
      process.exit(1);
    })
    .finally(() => pool?.end());
}
