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
  {
    name: "002_create_exercises",
    sql: `
      CREATE TABLE IF NOT EXISTS exercises (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        muscles     TEXT[]      NOT NULL DEFAULT '{}',
        category    TEXT        NOT NULL,
        is_system   BOOLEAN     NOT NULL DEFAULT false,
        created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS exercises_created_by_idx ON exercises (created_by);
      CREATE INDEX IF NOT EXISTS exercises_category_idx   ON exercises (category);
      CREATE INDEX IF NOT EXISTS exercises_muscles_idx    ON exercises USING GIN (muscles);

      CREATE OR REPLACE TRIGGER exercises_set_updated_at
        BEFORE UPDATE ON exercises
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE IF NOT EXISTS user_favourite_exercises (
        user_id     UUID        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
        exercise_id UUID        NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, exercise_id)
      );
    `,
  },
  {
    name: "003_seed_exercises",
    sql: `
      INSERT INTO exercises (id, name, muscles, category, is_system) VALUES
        ('a1000000-0000-0000-0000-000000000001', 'Wyciskanie sztangi na ławce',      ARRAY['chest','triceps'],                    'compound',    true),
        ('a1000000-0000-0000-0000-000000000002', 'Podciąganie na drążku',            ARRAY['back','biceps'],                      'compound',    true),
        ('a1000000-0000-0000-0000-000000000003', 'Przysiad ze sztangą',              ARRAY['legs','glutes'],                      'compound',    true),
        ('a1000000-0000-0000-0000-000000000004', 'Wyciskanie hantli nad głowę',      ARRAY['shoulders','triceps'],                'compound',    true),
        ('a1000000-0000-0000-0000-000000000005', 'Martwy ciąg',                      ARRAY['back','legs'],                        'compound',    true),
        ('a1000000-0000-0000-0000-000000000006', 'Uginanie ramion z hantlami',       ARRAY['biceps'],                             'isolation',   true),
        ('a1000000-0000-0000-0000-000000000007', 'Pompki na poręczach',              ARRAY['chest','triceps','shoulders'],        'calisthenics',true),
        ('a1000000-0000-0000-0000-000000000008', 'Wiosłowanie sztangą',              ARRAY['back','biceps'],                      'compound',    true),
        ('a1000000-0000-0000-0000-000000000009', 'Wypychanie nóg na suwnicy',        ARRAY['legs','glutes'],                      'isolation',   true),
        ('a1000000-0000-0000-0000-000000000010', 'Unoszenie ramion bokiem',          ARRAY['shoulders'],                          'isolation',   true),
        ('a1000000-0000-0000-0000-000000000011', 'Prostowanie ramion na wyciągu',    ARRAY['triceps'],                            'isolation',   true),
        ('a1000000-0000-0000-0000-000000000012', 'Plank',                            ARRAY['abs'],                                'calisthenics',true),
        ('a1000000-0000-0000-0000-000000000013', 'Burpees',                          ARRAY['legs','chest','abs'],                 'plyometric',  true),
        ('a1000000-0000-0000-0000-000000000014', 'Rozciąganie łańcucha tylnego',     ARRAY['legs','back'],                        'mobility',    true)
      ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    name: "004_exercises_description_image",
    sql: `
      ALTER TABLE exercises ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
      ALTER TABLE exercises ADD COLUMN IF NOT EXISTS image_url TEXT;
    `,
  },
  {
    name: "005_exercises_client_id",
    sql: `
      ALTER TABLE exercises ADD COLUMN IF NOT EXISTS client_id UUID;

      CREATE UNIQUE INDEX IF NOT EXISTS exercises_client_id_per_user
        ON exercises (created_by, client_id)
        WHERE client_id IS NOT NULL;
    `,
  },
  {
    name: "006_create_training_plans",
    sql: `
      CREATE TABLE IF NOT EXISTS training_plans (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id     UUID,
        name          TEXT        NOT NULL,
        note          TEXT,
        selected_days INTEGER[]   NOT NULL DEFAULT '{}',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS training_plans_client_id_per_user
        ON training_plans (user_id, client_id)
        WHERE client_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS training_plans_user_id_idx
        ON training_plans (user_id);

      CREATE OR REPLACE TRIGGER training_plans_set_updated_at
        BEFORE UPDATE ON training_plans
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE IF NOT EXISTS training_plan_exercises (
        id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id   UUID,
        plan_id     UUID    NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        exercise_id UUID    NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
        position    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS training_plan_exercises_plan_id_idx
        ON training_plan_exercises (plan_id);

      CREATE TABLE IF NOT EXISTS training_plan_sets (
        id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id        UUID,
        plan_exercise_id UUID    NOT NULL REFERENCES training_plan_exercises(id) ON DELETE CASCADE,
        position         INTEGER NOT NULL,
        weight           TEXT,
        reps             TEXT    NOT NULL DEFAULT '',
        rir              TEXT,
        tempo            TEXT
      );

      CREATE INDEX IF NOT EXISTS training_plan_sets_plan_exercise_id_idx
        ON training_plan_sets (plan_exercise_id);
    `,
  },
  {
    name: "007_create_training_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS training_sessions (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id      UUID,
        plan_id        UUID        REFERENCES training_plans(id) ON DELETE SET NULL,
        plan_client_id UUID,
        plan_name      TEXT        NOT NULL,
        status         TEXT        NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
        note           TEXT,
        started_at     TIMESTAMPTZ NOT NULL,
        finished_at    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS training_sessions_client_id_per_user
        ON training_sessions (user_id, client_id)
        WHERE client_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS training_sessions_one_active_per_user
        ON training_sessions (user_id)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS training_sessions_user_status_idx
        ON training_sessions (user_id, status, started_at DESC);

      CREATE OR REPLACE TRIGGER training_sessions_set_updated_at
        BEFORE UPDATE ON training_sessions
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE IF NOT EXISTS training_session_exercises (
        id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id           UUID,
        session_id          UUID    NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
        exercise_id         UUID    REFERENCES exercises(id) ON DELETE SET NULL,
        exercise_client_id  UUID,
        exercise_name       TEXT    NOT NULL,
        exercise_muscles    TEXT[]  NOT NULL DEFAULT '{}',
        exercise_category   TEXT    NOT NULL,
        exercise_image_url  TEXT,
        position            INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS training_session_exercises_session_id_idx
        ON training_session_exercises (session_id);

      CREATE TABLE IF NOT EXISTS training_session_sets (
        id                          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id                   UUID,
        session_exercise_id         UUID    NOT NULL REFERENCES training_session_exercises(id) ON DELETE CASCADE,
        position                    INTEGER NOT NULL,
        planned_weight              TEXT,
        planned_reps                TEXT    NOT NULL DEFAULT '',
        planned_rir                 TEXT,
        planned_tempo               TEXT,
        actual_weight               TEXT,
        actual_reps                 TEXT,
        actual_rir                  TEXT,
        actual_tempo                TEXT,
        completed                   BOOLEAN NOT NULL DEFAULT false,
        completed_at                TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS training_session_sets_exercise_id_idx
        ON training_session_sets (session_exercise_id);
    `,
  },
  {
    name: "008_training_session_sets_actual_tempo",
    sql: `
      ALTER TABLE training_session_sets
        ADD COLUMN IF NOT EXISTS actual_tempo TEXT;
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
