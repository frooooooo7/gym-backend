import { logger, serializeError } from "../common/logger.js";
import { getPool } from "./pool.js";
import { syncSystemExerciseImages } from "../modules/exercises/system-exercise-images.js";

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

      CREATE INDEX IF NOT EXISTS training_sessions_user_plan_started_idx
        ON training_sessions (user_id, plan_id, started_at DESC, id DESC);

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
  {
    name: "009_user_profile_and_follows",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

      UPDATE users
      SET handle = lower(
        regexp_replace(
          translate(
            first_name || '.' || last_name,
            'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
            'acelnoszzacelnoszz'
          ),
          '[^a-z0-9._]', '', 'g'
        )
      ) || '_' || left(replace(id::text, '-', ''), 6)
      WHERE handle IS NULL;

      ALTER TABLE users ALTER COLUMN handle SET NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique_idx ON users (handle);

      CREATE TABLE IF NOT EXISTS user_follows (
        follower_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (follower_id, following_id),
        CHECK (follower_id <> following_id)
      );

      CREATE INDEX IF NOT EXISTS user_follows_follower_idx
        ON user_follows (follower_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS user_follows_following_idx
        ON user_follows (following_id, created_at DESC);
    `,
  },
  {
    name: "010_training_sessions_shared_to_profile",
    sql: `
      ALTER TABLE training_sessions
        ADD COLUMN IF NOT EXISTS shared_to_profile BOOLEAN NOT NULL DEFAULT false;

      -- Sesje ukończone przed wprowadzeniem flagi były widoczne na profilu
      -- bezwarunkowo — zachowujemy to, żeby istniejące profile nie opustoszały.
      UPDATE training_sessions
      SET shared_to_profile = true
      WHERE status = 'completed';

      CREATE INDEX IF NOT EXISTS training_sessions_user_shared_idx
        ON training_sessions (user_id, started_at DESC)
        WHERE status = 'completed' AND shared_to_profile = true;
    `,
  },
  {
    name: "011_performance_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS training_sessions_user_started_idx
        ON training_sessions (user_id, started_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS training_sessions_user_updated_idx
        ON training_sessions (user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS training_sessions_plan_id_idx
        ON training_sessions (plan_id) WHERE plan_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS training_plan_exercises_exercise_id_idx
        ON training_plan_exercises (exercise_id);
      CREATE INDEX IF NOT EXISTS training_session_exercises_exercise_id_idx
        ON training_session_exercises (exercise_id) WHERE exercise_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS user_favourite_exercises_exercise_id_idx
        ON user_favourite_exercises (exercise_id);
      CREATE INDEX IF NOT EXISTS training_plans_user_updated_idx
        ON training_plans (user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS training_sessions_user_status_started_id_idx
        ON training_sessions (user_id, status, started_at DESC, id DESC);
    `,
  },
  {
    // Osobno i bez twardego wymagania: na hostowanym Postgresie rola bywa bez
    // prawa do CREATE EXTENSION (albo pg_trgm siedzi w innym schemacie) —
    // wtedy wyszukiwanie działa bez indeksów trigramowych, zamiast blokować
    // start serwera.
    name: "012_trigram_search_indexes",
    sql: `
      DO $$
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pg_trgm unavailable, skipping trigram indexes: %', SQLERRM;
      END
      $$;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
          CREATE INDEX IF NOT EXISTS users_handle_trgm_idx
            ON users USING GIN (lower(handle) gin_trgm_ops);
          CREATE INDEX IF NOT EXISTS users_fullname_trgm_idx
            ON users USING GIN (lower(first_name || ' ' || last_name) gin_trgm_ops);
          CREATE INDEX IF NOT EXISTS exercises_name_trgm_idx
            ON exercises USING GIN (lower(name) gin_trgm_ops);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'trigram indexes skipped: %', SQLERRM;
      END
      $$;
    `,
  },
  {
    name: "013_social_feed",
    sql: `
      CREATE TABLE IF NOT EXISTS session_kudos (
        session_id UUID        NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS session_kudos_user_idx
        ON session_kudos (user_id);

      -- "recent kudos" (LIMIT 3 per post) and the kudos list, newest first.
      CREATE INDEX IF NOT EXISTS session_kudos_session_created_idx
        ON session_kudos (session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS session_comments (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID        NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS session_comments_session_created_idx
        ON session_comments (session_id, created_at, id);

      -- ON DELETE CASCADE from users would otherwise seq-scan comments.
      CREATE INDEX IF NOT EXISTS session_comments_user_idx
        ON session_comments (user_id);

      CREATE OR REPLACE TRIGGER session_comments_set_updated_at
        BEFORE UPDATE ON session_comments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      -- Feed: globally ordered shared posts; filtered by the author set.
      CREATE INDEX IF NOT EXISTS training_sessions_feed_idx
        ON training_sessions (started_at DESC, id DESC)
        WHERE status = 'completed' AND shared_to_profile = true;

      -- Feed (few followings / deep pages): per-author scan with id tie-break.
      CREATE INDEX IF NOT EXISTS training_sessions_user_shared_started_id_idx
        ON training_sessions (user_id, started_at DESC, id DESC)
        WHERE status = 'completed' AND shared_to_profile = true;
    `,
  },
  {
    name: "014_training_session_tombstones",
    sql: `
      -- Deleted sessions leave a tombstone so an offline client's queued
      -- POST (upsert by clientId) cannot resurrect them, and other devices
      -- learn about the deletion via GET /training-sessions/history.
      -- session_id is the deleted session's id, or a random uuid when the
      -- session was deleted by client id before it ever reached the server.
      CREATE TABLE IF NOT EXISTS training_session_tombstones (
        session_id UUID        PRIMARY KEY,
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id  UUID,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS training_session_tombstones_client_id_per_user
        ON training_session_tombstones (user_id, client_id)
        WHERE client_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS training_session_tombstones_user_deleted_idx
        ON training_session_tombstones (user_id, deleted_at);
    `,
  },
  {
    // Bumped on change-password / logout-all; JWTs carry it as the "tv"
    // claim and requireAuth rejects tokens whose "tv" is stale.
    name: "015_users_token_version",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // Private body/goal data filled in during onboarding (NULL = not given);
    // only /profile/me* responses expose it. Existing accounts count as
    // onboarded so they never see the new flow.
    name: "016_users_profile_details",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS birth_date DATE,
        ADD COLUMN IF NOT EXISTS gender TEXT
          CHECK (gender IN ('male', 'female', 'other')),
        ADD COLUMN IF NOT EXISTS height_cm SMALLINT
          CHECK (height_cm BETWEEN 100 AND 250),
        ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(4,1)
          CHECK (weight_kg BETWEEN 30 AND 300),
        ADD COLUMN IF NOT EXISTS training_goal TEXT
          CHECK (training_goal IN ('strength', 'muscle', 'fat_loss', 'general')),
        ADD COLUMN IF NOT EXISTS experience_level TEXT
          CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
        ADD COLUMN IF NOT EXISTS weekly_training_days SMALLINT
          CHECK (weekly_training_days BETWEEN 1 AND 7),
        ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

      UPDATE users
      SET onboarding_completed_at = created_at
      WHERE onboarding_completed_at IS NULL;
    `,
  },
  {
    // Set types (warm-up / normal / failure / drop) and a per-exercise note in
    // a session. Existing sets are 'normal'. Warm-up sets are excluded from
    // volume, set counts and best-set aggregates (see sql-fragments.ts).
    name: "017_session_set_type_and_exercise_note",
    sql: `
      ALTER TABLE training_session_sets
        ADD COLUMN IF NOT EXISTS set_type TEXT NOT NULL DEFAULT 'normal'
          CHECK (set_type IN ('normal', 'warmup', 'failure', 'drop'));

      ALTER TABLE training_session_exercises
        ADD COLUMN IF NOT EXISTS note TEXT;
    `,
  },
  {
    // Body weight log, one entry per calendar day in the client's timezone.
    // users.weight_kg stays the "current weight" and follows the newest
    // entry. Existing profile weights become each account's first entry.
    name: "018_body_weight_entries",
    sql: `
      CREATE TABLE IF NOT EXISTS body_weight_entries (
        user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        measured_on DATE         NOT NULL,
        weight_kg   NUMERIC(4,1) NOT NULL CHECK (weight_kg BETWEEN 30 AND 300),
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, measured_on)
      );

      INSERT INTO body_weight_entries (user_id, measured_on, weight_kg)
      SELECT id, COALESCE(onboarding_completed_at, created_at)::date, weight_kg
      FROM users
      WHERE weight_kg IS NOT NULL
      ON CONFLICT DO NOTHING;
    `,
  },
  {
    // Body measurements log (circumferences in cm, body fat %), one entry
    // per calendar day in the client's timezone. Every value is optional,
    // but an entry carries at least one.
    name: "019_body_measurement_entries",
    sql: `
      CREATE TABLE IF NOT EXISTS body_measurement_entries (
        user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        measured_on  DATE         NOT NULL,
        waist_cm     NUMERIC(4,1) CHECK (waist_cm BETWEEN 10 AND 300),
        chest_cm     NUMERIC(4,1) CHECK (chest_cm BETWEEN 10 AND 300),
        hips_cm      NUMERIC(4,1) CHECK (hips_cm BETWEEN 10 AND 300),
        neck_cm      NUMERIC(4,1) CHECK (neck_cm BETWEEN 10 AND 300),
        arm_cm       NUMERIC(4,1) CHECK (arm_cm BETWEEN 10 AND 300),
        thigh_cm     NUMERIC(4,1) CHECK (thigh_cm BETWEEN 10 AND 300),
        calf_cm      NUMERIC(4,1) CHECK (calf_cm BETWEEN 10 AND 300),
        body_fat_pct NUMERIC(3,1) CHECK (body_fat_pct BETWEEN 2 AND 75),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, measured_on),
        CHECK (num_nonnulls(waist_cm, chest_cm, hips_cm, neck_cm, arm_cm,
                            thigh_cm, calf_cm, body_fat_pct) > 0)
      );
    `,
  },
  {
    // Optional body weight goal (NULL = no goal), private like the other
    // profile details; the app shows progress and a projected date.
    name: "020_users_target_weight",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS target_weight_kg NUMERIC(4,1)
          CHECK (target_weight_kg BETWEEN 30 AND 300);
    `,
  },
  {
    // Plan look and behaviour (colour, icon, goal, progression step, which
    // columns the workout screen shows), rest per exercise and supersets.
    // Sessions keep a copy of the plan's colour/icon and of each exercise's
    // rest and superset group, so history survives plan edits and deletes.
    name: "021_plan_customization_rest_supersets",
    sql: `
      ALTER TABLE training_plans
        ADD COLUMN IF NOT EXISTS default_rest_seconds INTEGER NOT NULL DEFAULT 120
          CHECK (default_rest_seconds BETWEEN 0 AND 1800),
        ADD COLUMN IF NOT EXISTS color_key TEXT
          CHECK (color_key ~ '^[a-z]{1,24}$'),
        ADD COLUMN IF NOT EXISTS icon_key TEXT
          CHECK (icon_key ~ '^[a-z_]{1,24}$'),
        ADD COLUMN IF NOT EXISTS goal TEXT
          CHECK (goal IN ('strength', 'hypertrophy', 'endurance')),
        ADD COLUMN IF NOT EXISTS progression_step_kg NUMERIC(4,2)
          CHECK (progression_step_kg > 0 AND progression_step_kg <= 20),
        ADD COLUMN IF NOT EXISTS highlight_plan_color BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS show_rir BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS show_tempo BOOLEAN NOT NULL DEFAULT true;

      ALTER TABLE training_plan_exercises
        ADD COLUMN IF NOT EXISTS rest_seconds INTEGER
          CHECK (rest_seconds BETWEEN 0 AND 1800),
        ADD COLUMN IF NOT EXISTS superset_group TEXT
          CHECK (superset_group ~ '^[A-Z]$');

      ALTER TABLE training_session_exercises
        ADD COLUMN IF NOT EXISTS rest_seconds INTEGER
          CHECK (rest_seconds BETWEEN 0 AND 1800),
        ADD COLUMN IF NOT EXISTS superset_group TEXT
          CHECK (superset_group ~ '^[A-Z]$');

      ALTER TABLE training_sessions
        ADD COLUMN IF NOT EXISTS plan_color_key TEXT
          CHECK (plan_color_key ~ '^[a-z]{1,24}$'),
        ADD COLUMN IF NOT EXISTS plan_icon_key TEXT
          CHECK (plan_icon_key ~ '^[a-z_]{1,24}$');
    `,
  },
  {
    name: "022_cardio_tracking",
    sql: `
      ALTER TABLE exercises
        ADD COLUMN IF NOT EXISTS tracking_type TEXT NOT NULL DEFAULT 'weight_reps'
          CHECK (tracking_type IN ('weight_reps', 'reps', 'duration', 'duration_distance')),
        ADD COLUMN IF NOT EXISTS distance_unit TEXT NOT NULL DEFAULT 'km'
          CHECK (distance_unit IN ('km', 'm'));

      -- Plank i burpees zostają przy ciężarze × powt.: istniejące plany
      -- mają w nich wpisane powtórzenia, a nie czas.
      INSERT INTO exercises (id, name, muscles, category, is_system, tracking_type, distance_unit) VALUES
        ('a1000000-0000-0000-0000-000000000015', 'Bieżnia',           ARRAY['legs','glutes'],          'cardio', true, 'duration_distance', 'km'),
        ('a1000000-0000-0000-0000-000000000016', 'Rower stacjonarny', ARRAY['legs'],                   'cardio', true, 'duration_distance', 'km'),
        ('a1000000-0000-0000-0000-000000000017', 'Wioślarz',          ARRAY['back','legs','biceps'],   'cardio', true, 'duration_distance', 'm'),
        ('a1000000-0000-0000-0000-000000000018', 'Orbitrek',          ARRAY['legs','glutes'],          'cardio', true, 'duration',          'km'),
        ('a1000000-0000-0000-0000-000000000019', 'Skakanka',          ARRAY['legs'],                   'cardio', true, 'duration',          'km')
      ON CONFLICT (id) DO NOTHING;

      ALTER TABLE training_plan_sets
        ADD COLUMN IF NOT EXISTS duration_seconds INTEGER
          CHECK (duration_seconds BETWEEN 0 AND 86400),
        ADD COLUMN IF NOT EXISTS distance_m INTEGER
          CHECK (distance_m BETWEEN 0 AND 1000000);

      ALTER TABLE training_session_exercises
        ADD COLUMN IF NOT EXISTS exercise_tracking_type TEXT
          CHECK (exercise_tracking_type IN ('weight_reps', 'reps', 'duration', 'duration_distance')),
        ADD COLUMN IF NOT EXISTS exercise_distance_unit TEXT
          CHECK (exercise_distance_unit IN ('km', 'm'));

      ALTER TABLE training_session_sets
        ADD COLUMN IF NOT EXISTS planned_duration_seconds INTEGER
          CHECK (planned_duration_seconds BETWEEN 0 AND 86400),
        ADD COLUMN IF NOT EXISTS planned_distance_m INTEGER
          CHECK (planned_distance_m BETWEEN 0 AND 1000000),
        ADD COLUMN IF NOT EXISTS actual_duration_seconds INTEGER
          CHECK (actual_duration_seconds BETWEEN 0 AND 86400),
        ADD COLUMN IF NOT EXISTS actual_distance_m INTEGER
          CHECK (actual_distance_m BETWEEN 0 AND 1000000);
    `,
  },
  {
    name: "023_plan_sharing",
    sql: `
      -- Plany są domyślnie prywatne; kopia pamięta, od kogo pochodzi.
      ALTER TABLE training_plans
        ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS copied_from_plan_id UUID
          REFERENCES training_plans(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS copied_from_user_id UUID
          REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS copy_count INTEGER NOT NULL DEFAULT 0
          CHECK (copy_count >= 0);

      CREATE INDEX IF NOT EXISTS training_plans_public_idx
        ON training_plans (user_id, updated_at DESC)
        WHERE is_public = true;

      -- Czyjaś kopia podbija tylko licznik — to nie edycja planu, więc
      -- updated_at (kolejność listy i synchronizacja autora) zostaje.
      CREATE OR REPLACE FUNCTION training_plans_set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.copy_count IS DISTINCT FROM OLD.copy_count
           AND (to_jsonb(NEW) - 'copy_count' - 'updated_at')
             = (to_jsonb(OLD) - 'copy_count' - 'updated_at') THEN
          RETURN NEW;
        END IF;
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE TRIGGER training_plans_set_updated_at
        BEFORE UPDATE ON training_plans
        FOR EACH ROW EXECUTE FUNCTION training_plans_set_updated_at();
    `,
  },
  {
    name: "024_notifications",
    sql: `
      -- Powiadomienia liczą się z kudosów, obserwacji, kopii planów i postów
      -- z rekordami. Tu tylko stan: przeczytane, usunięte i ustawienia.
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS notifications_read_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL
          DEFAULT '{}'::jsonb;

      CREATE TABLE IF NOT EXISTS notification_marks (
        user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key          TEXT        NOT NULL,
        read_at      TIMESTAMPTZ,
        dismissed_at TIMESTAMPTZ,
        PRIMARY KEY (user_id, key)
      );

      CREATE INDEX IF NOT EXISTS training_plans_copied_from_user_idx
        ON training_plans (copied_from_user_id, created_at DESC)
        WHERE copied_from_user_id IS NOT NULL;
    `,
  },
  {
    // Suggested users fill the list with the newest accounts — walk an index
    // instead of sorting the whole users table per request.
    name: "025_users_created_at_idx",
    sql: `
      CREATE INDEX IF NOT EXISTS users_created_at_idx
        ON users (created_at DESC, id DESC);
    `,
  },
  {
    // A shared workout can carry its own post title and one photo; the post
    // body reuses the session note.
    name: "026_training_session_post_title_photo",
    sql: `
      ALTER TABLE training_sessions
        ADD COLUMN IF NOT EXISTS post_title TEXT,
        ADD COLUMN IF NOT EXISTS post_photo_url TEXT;
      ALTER TABLE training_sessions
        DROP CONSTRAINT IF EXISTS training_sessions_post_title_length;
      ALTER TABLE training_sessions
        ADD CONSTRAINT training_sessions_post_title_length
        CHECK (post_title IS NULL OR char_length(post_title) BETWEEN 1 AND 80);
    `,
  },
  {
    // Exercises from the training plan that the library lacked. Their
    // illustrations are attached on every start by syncSystemExerciseImages.
    name: "027_seed_plan_exercises",
    sql: `
      INSERT INTO exercises (id, name, muscles, category, is_system, tracking_type) VALUES
        ('a1000000-0000-0000-0000-000000000020', 'Handstand',                                        ARRAY['shoulders','triceps','abs'],  'calisthenics', true, 'duration'),
        ('a1000000-0000-0000-0000-000000000021', 'Negatywy pompek w staniu na rękach',               ARRAY['shoulders','triceps'],        'calisthenics', true, 'reps'),
        ('a1000000-0000-0000-0000-000000000022', 'Rozpiętki skośne z hantlami',                      ARRAY['chest'],                      'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000023', 'Prostowanie ramion z hantlem nad głową',           ARRAY['triceps'],                    'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000024', 'Muscle-up',                                        ARRAY['back','triceps','chest'],     'calisthenics', true, 'reps'),
        ('a1000000-0000-0000-0000-000000000025', 'Podciąganie z obciążeniem',                        ARRAY['back','biceps'],              'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000026', 'Wiosłowanie T-bar',                                ARRAY['back','biceps'],              'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000027', 'Wiosłowanie T-bar na maszynie z podparciem klatki', ARRAY['back','biceps'],             'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000028', 'Przyciąganie siedząc, wąski uchwyt neutralny',     ARRAY['back','biceps'],              'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000029', 'Face pull',                                        ARRAY['shoulders','back'],           'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000030', 'Uginanie ramion ze sztangą',                       ARRAY['biceps'],                     'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000031', 'Uginanie młotkowe z hantlami',                     ARRAY['biceps'],                     'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000032', 'Front lever',                                      ARRAY['back','abs'],                 'calisthenics', true, 'duration'),
        ('a1000000-0000-0000-0000-000000000033', 'Martwy ciąg rumuński (RDL)',                       ARRAY['legs','glutes','back'],       'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000034', 'Uginanie nóg leżąc',                               ARRAY['legs'],                       'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000035', 'Prostowanie nóg na maszynie',                      ARRAY['legs'],                       'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000036', 'Wspięcia na palce (łydki)',                        ARRAY['legs'],                       'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000037', 'Unoszenie nóg w zwisie',                           ARRAY['abs'],                        'calisthenics', true, 'reps'),
        ('a1000000-0000-0000-0000-000000000038', 'Spięcia brzucha na maszynie',                      ARRAY['abs'],                        'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000039', 'Wyciskanie sztangi stojąc (OHP)',                  ARRAY['shoulders','triceps'],        'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000040', 'Odwrotne rozpiętki',                               ARRAY['shoulders','back'],           'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000041', 'Uginanie na modlitewniku',                         ARRAY['biceps'],                     'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000042', 'Wyciskanie francuskie leżąc',                      ARRAY['triceps'],                    'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000043', 'Uginanie młotkowe z liną na wyciągu',              ARRAY['biceps'],                     'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000044', 'Wyciskanie hantli na ławce skośnej',               ARRAY['chest','shoulders','triceps'],'compound',     true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000045', 'Rozpiętki na maszynie (butterfly)',                ARRAY['chest'],                      'isolation',    true, 'weight_reps'),
        ('a1000000-0000-0000-0000-000000000046', 'Ściąganie drążka wyciągu',                         ARRAY['back','biceps'],              'compound',     true, 'weight_reps')
      ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    // Popular gym exercises the library still lacked (ids ...047-...096).
    // Illustrations are attached on start by syncSystemExerciseImages.
    name: "028_seed_popular_exercises",
    sql: `
      INSERT INTO exercises (id, name, muscles, category, is_system, tracking_type, distance_unit) VALUES
        ('a1000000-0000-0000-0000-000000000047', 'Wyciskanie sztangi na ławce skośnej', ARRAY['chest','shoulders','triceps'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000048', 'Wyciskanie hantli na ławce płaskiej', ARRAY['chest','triceps','shoulders'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000049', 'Pompki', ARRAY['chest','triceps','shoulders'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000050', 'Rozpiętki na bramie', ARRAY['chest','shoulders'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000051', 'Przysiad przedni', ARRAY['legs','glutes','abs'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000052', 'Przysiad bułgarski', ARRAY['legs','glutes'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000053', 'Wykroki z hantlami', ARRAY['legs','glutes'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000054', 'Hip thrust ze sztangą', ARRAY['glutes','legs'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000055', 'Wiosłowanie hantlem jednorącz', ARRAY['back','biceps'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000056', 'Podciąganie podchwytem', ARRAY['back','biceps'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000057', 'Przysiad na maszynie hack', ARRAY['legs','glutes'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000058', 'Przysiad goblet', ARRAY['legs','glutes'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000059', 'Uginanie nóg siedząc', ARRAY['legs'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000060', 'Szrugsy z hantlami', ARRAY['back','shoulders'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000061', 'Wyciskanie Arnolda', ARRAY['shoulders','triceps'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000062', 'Wyciskanie sztangi wąskim chwytem', ARRAY['triceps','chest'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000063', 'Wspięcia na palce siedząc', ARRAY['legs'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000064', 'Brzuszki', ARRAY['abs'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000065', 'Martwy ciąg sumo', ARRAY['legs','glutes','back'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000066', 'Rozpiętki z hantlami na ławce płaskiej', ARRAY['chest','shoulders'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000067', 'Wyciskanie na maszynie', ARRAY['chest','triceps','shoulders'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000068', 'Swing kettlebell', ARRAY['glutes','legs','back'], 'plyometric', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000069', 'Kółko do brzucha', ARRAY['abs','shoulders'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000070', 'Russian twist', ARRAY['abs'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000071', 'Deska bokiem', ARRAY['abs','shoulders'], 'calisthenics', true, 'duration', 'km'),
        ('a1000000-0000-0000-0000-000000000072', 'Prostowanie ramienia z hantlem w opadzie', ARRAY['triceps'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000073', 'Uginanie skoncentrowane', ARRAY['biceps'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000074', 'Uginanie ramion na wyciągu', ARRAY['biceps'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000075', 'Odwodzenie nóg na maszynie', ARRAY['glutes'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000076', 'Skłony ze sztangą (good morning)', ARRAY['legs','back','glutes'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000077', 'Pompki w podporze tyłem', ARRAY['triceps','chest','shoulders'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000078', 'Mostek biodrowy', ARRAY['glutes','legs'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000079', 'Wspinaczka górska', ARRAY['abs','legs','shoulders'], 'plyometric', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000080', 'Ściąganie drążka prostymi ramionami', ARRAY['back'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000081', 'Przenoszenie hantla za głowę (pullover)', ARRAY['chest','back'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000082', 'Wyprosty tułowia na ławce rzymskiej', ARRAY['back','glutes','legs'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000083', 'Podciąganie sztangi wzdłuż tułowia', ARRAY['shoulders','back'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000084', 'Unoszenie hantli przodem', ARRAY['shoulders'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000085', 'Unoszenie ramienia bokiem na wyciągu', ARRAY['shoulders'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000086', 'Wyciskanie sztangi na ławce skośnej w dół', ARRAY['chest','triceps'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000087', 'Wiosłowanie w zwisie (australijskie podciąganie)', ARRAY['back','biceps'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000088', 'Wejścia na skrzynię z hantlami', ARRAY['legs','glutes'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000089', 'Unoszenie nóg w leżeniu', ARRAY['abs'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000090', 'Rowerek', ARRAY['abs'], 'calisthenics', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000091', 'Przywodzenie nóg na maszynie', ARRAY['legs'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000092', 'Spacer farmera', ARRAY['back','legs','abs'], 'compound', true, 'duration_distance', 'm'),
        ('a1000000-0000-0000-0000-000000000093', 'Wskoki na skrzynię', ARRAY['legs','glutes'], 'plyometric', true, 'reps', 'km'),
        ('a1000000-0000-0000-0000-000000000094', 'Drwal na wyciągu', ARRAY['abs'], 'isolation', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000095', 'Wyciskanie nad głowę na maszynie', ARRAY['shoulders','triceps'], 'compound', true, 'weight_reps', 'km'),
        ('a1000000-0000-0000-0000-000000000096', 'Odwodzenie nogi w tył na wyciągu', ARRAY['glutes'], 'isolation', true, 'weight_reps', 'km')
      ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    // Weight progression chosen by the user (Settings → Progresja) and an
    // optional per-plan override. NULL = never set: no progression for the
    // account, and the account setting for the plan.
    name: "029_progression_settings",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS progression_settings JSONB;
      ALTER TABLE training_plans
        ADD COLUMN IF NOT EXISTS progression JSONB;
    `,
  },
  {
    name: "030_granular_muscle_tags",
    sql: `
      -- Ćwiczenia systemowe dostają konkretne mięśnie zamiast grup zbiorczych
      -- (back, legs, shoulders), żeby mapa mięśni w aplikacji nie musiała
      -- zgadywać. Pierwszy tag to cel ćwiczenia, kolejne wspomagają.
      -- Ćwiczenia użytkowników i snapshoty sesji zostają bez zmian: stare
      -- tagi zbiorcze nadal są poprawne i aplikacja je rozumie.
      UPDATE exercises AS e
      SET muscles = v.muscles
      FROM (VALUES
        ('a1000000-0000-0000-0000-000000000001', ARRAY['chest','triceps','frontDelts']),
        ('a1000000-0000-0000-0000-000000000002', ARRAY['lats','biceps','rhomboids']),
        ('a1000000-0000-0000-0000-000000000003', ARRAY['quads','glutes','hamstrings']),
        ('a1000000-0000-0000-0000-000000000004', ARRAY['frontDelts','triceps','sideDelts']),
        ('a1000000-0000-0000-0000-000000000005', ARRAY['glutes','hamstrings','lowerBack','traps']),
        ('a1000000-0000-0000-0000-000000000006', ARRAY['biceps','forearms']),
        ('a1000000-0000-0000-0000-000000000007', ARRAY['chest','triceps','frontDelts']),
        ('a1000000-0000-0000-0000-000000000008', ARRAY['lats','rhomboids','biceps','rearDelts']),
        ('a1000000-0000-0000-0000-000000000009', ARRAY['quads','glutes']),
        ('a1000000-0000-0000-0000-000000000010', ARRAY['sideDelts']),
        ('a1000000-0000-0000-0000-000000000011', ARRAY['triceps']),
        ('a1000000-0000-0000-0000-000000000012', ARRAY['abs','obliques']),
        ('a1000000-0000-0000-0000-000000000013', ARRAY['quads','chest','abs']),
        ('a1000000-0000-0000-0000-000000000014', ARRAY['hamstrings','lowerBack']),
        ('a1000000-0000-0000-0000-000000000015', ARRAY['quads','hamstrings','calves','glutes']),
        ('a1000000-0000-0000-0000-000000000016', ARRAY['quads','glutes','calves']),
        ('a1000000-0000-0000-0000-000000000017', ARRAY['lats','quads','biceps']),
        ('a1000000-0000-0000-0000-000000000018', ARRAY['quads','glutes','hamstrings']),
        ('a1000000-0000-0000-0000-000000000019', ARRAY['calves','quads']),
        ('a1000000-0000-0000-0000-000000000020', ARRAY['frontDelts','triceps','abs']),
        ('a1000000-0000-0000-0000-000000000021', ARRAY['frontDelts','triceps','sideDelts']),
        ('a1000000-0000-0000-0000-000000000022', ARRAY['chest']),
        ('a1000000-0000-0000-0000-000000000023', ARRAY['triceps']),
        ('a1000000-0000-0000-0000-000000000024', ARRAY['lats','triceps','chest']),
        ('a1000000-0000-0000-0000-000000000025', ARRAY['lats','biceps','rhomboids']),
        ('a1000000-0000-0000-0000-000000000026', ARRAY['lats','rhomboids','biceps']),
        ('a1000000-0000-0000-0000-000000000027', ARRAY['lats','rhomboids','biceps']),
        ('a1000000-0000-0000-0000-000000000028', ARRAY['lats','rhomboids','biceps']),
        ('a1000000-0000-0000-0000-000000000029', ARRAY['rearDelts','rhomboids','traps']),
        ('a1000000-0000-0000-0000-000000000030', ARRAY['biceps','forearms']),
        ('a1000000-0000-0000-0000-000000000031', ARRAY['biceps','forearms']),
        ('a1000000-0000-0000-0000-000000000032', ARRAY['lats','abs']),
        ('a1000000-0000-0000-0000-000000000033', ARRAY['hamstrings','glutes','lowerBack']),
        ('a1000000-0000-0000-0000-000000000034', ARRAY['hamstrings']),
        ('a1000000-0000-0000-0000-000000000035', ARRAY['quads']),
        ('a1000000-0000-0000-0000-000000000036', ARRAY['calves']),
        ('a1000000-0000-0000-0000-000000000037', ARRAY['abs']),
        ('a1000000-0000-0000-0000-000000000038', ARRAY['abs']),
        ('a1000000-0000-0000-0000-000000000039', ARRAY['frontDelts','triceps','sideDelts']),
        ('a1000000-0000-0000-0000-000000000040', ARRAY['rearDelts','rhomboids']),
        ('a1000000-0000-0000-0000-000000000041', ARRAY['biceps']),
        ('a1000000-0000-0000-0000-000000000042', ARRAY['triceps']),
        ('a1000000-0000-0000-0000-000000000043', ARRAY['biceps','forearms']),
        ('a1000000-0000-0000-0000-000000000044', ARRAY['chest','frontDelts','triceps']),
        ('a1000000-0000-0000-0000-000000000045', ARRAY['chest']),
        ('a1000000-0000-0000-0000-000000000046', ARRAY['lats','biceps','rhomboids']),
        ('a1000000-0000-0000-0000-000000000047', ARRAY['chest','frontDelts','triceps']),
        ('a1000000-0000-0000-0000-000000000048', ARRAY['chest','triceps','frontDelts']),
        ('a1000000-0000-0000-0000-000000000049', ARRAY['chest','triceps','frontDelts']),
        ('a1000000-0000-0000-0000-000000000050', ARRAY['chest','frontDelts']),
        ('a1000000-0000-0000-0000-000000000051', ARRAY['quads','glutes','abs']),
        ('a1000000-0000-0000-0000-000000000052', ARRAY['quads','glutes']),
        ('a1000000-0000-0000-0000-000000000053', ARRAY['quads','glutes','hamstrings']),
        ('a1000000-0000-0000-0000-000000000054', ARRAY['glutes','hamstrings']),
        ('a1000000-0000-0000-0000-000000000055', ARRAY['lats','rhomboids','biceps','rearDelts']),
        ('a1000000-0000-0000-0000-000000000056', ARRAY['lats','biceps']),
        ('a1000000-0000-0000-0000-000000000057', ARRAY['quads','glutes']),
        ('a1000000-0000-0000-0000-000000000058', ARRAY['quads','glutes']),
        ('a1000000-0000-0000-0000-000000000059', ARRAY['hamstrings']),
        ('a1000000-0000-0000-0000-000000000060', ARRAY['traps']),
        ('a1000000-0000-0000-0000-000000000061', ARRAY['frontDelts','sideDelts','triceps']),
        ('a1000000-0000-0000-0000-000000000062', ARRAY['triceps','chest','frontDelts']),
        ('a1000000-0000-0000-0000-000000000063', ARRAY['calves']),
        ('a1000000-0000-0000-0000-000000000064', ARRAY['abs']),
        ('a1000000-0000-0000-0000-000000000065', ARRAY['glutes','adductors','quads','lowerBack']),
        ('a1000000-0000-0000-0000-000000000066', ARRAY['chest','frontDelts']),
        ('a1000000-0000-0000-0000-000000000067', ARRAY['chest','triceps','frontDelts']),
        ('a1000000-0000-0000-0000-000000000068', ARRAY['glutes','hamstrings','lowerBack']),
        ('a1000000-0000-0000-0000-000000000069', ARRAY['abs','lats','frontDelts']),
        ('a1000000-0000-0000-0000-000000000070', ARRAY['obliques','abs']),
        ('a1000000-0000-0000-0000-000000000071', ARRAY['obliques','sideDelts']),
        ('a1000000-0000-0000-0000-000000000072', ARRAY['triceps']),
        ('a1000000-0000-0000-0000-000000000073', ARRAY['biceps']),
        ('a1000000-0000-0000-0000-000000000074', ARRAY['biceps']),
        ('a1000000-0000-0000-0000-000000000075', ARRAY['glutes']),
        ('a1000000-0000-0000-0000-000000000076', ARRAY['hamstrings','glutes','lowerBack']),
        ('a1000000-0000-0000-0000-000000000077', ARRAY['triceps','chest','frontDelts']),
        ('a1000000-0000-0000-0000-000000000078', ARRAY['glutes','hamstrings']),
        ('a1000000-0000-0000-0000-000000000079', ARRAY['abs','quads','frontDelts']),
        ('a1000000-0000-0000-0000-000000000080', ARRAY['lats']),
        ('a1000000-0000-0000-0000-000000000081', ARRAY['chest','lats']),
        ('a1000000-0000-0000-0000-000000000082', ARRAY['lowerBack','glutes','hamstrings']),
        ('a1000000-0000-0000-0000-000000000083', ARRAY['sideDelts','traps']),
        ('a1000000-0000-0000-0000-000000000084', ARRAY['frontDelts']),
        ('a1000000-0000-0000-0000-000000000085', ARRAY['sideDelts']),
        ('a1000000-0000-0000-0000-000000000086', ARRAY['chest','triceps']),
        ('a1000000-0000-0000-0000-000000000087', ARRAY['lats','rhomboids','biceps']),
        ('a1000000-0000-0000-0000-000000000088', ARRAY['quads','glutes']),
        ('a1000000-0000-0000-0000-000000000089', ARRAY['abs']),
        ('a1000000-0000-0000-0000-000000000090', ARRAY['abs','obliques']),
        ('a1000000-0000-0000-0000-000000000091', ARRAY['adductors']),
        ('a1000000-0000-0000-0000-000000000092', ARRAY['traps','forearms','abs','glutes']),
        ('a1000000-0000-0000-0000-000000000093', ARRAY['quads','glutes','calves']),
        ('a1000000-0000-0000-0000-000000000094', ARRAY['obliques','abs']),
        ('a1000000-0000-0000-0000-000000000095', ARRAY['frontDelts','triceps','sideDelts']),
        ('a1000000-0000-0000-0000-000000000096', ARRAY['glutes','hamstrings'])
      ) AS v(id, muscles)
      WHERE e.id = v.id::uuid AND e.is_system = true;
    `,
  },
];

const ADVISORY_LOCK_ID = 3_742_116_919;

export const runMigrations = async (): Promise<void> => {
  const pool = getPool();
  if (!pool) {
    logger.warn("[migrate] DATABASE_URL not set — skipping migrations");
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
        // The pool's statement_timeout is sized for requests, not for
        // backfills over whole tables.
        await client.query("SET LOCAL statement_timeout = 0");
        await client.query(migration.sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
          migration.name,
        ]);
        await client.query("COMMIT");
        logger.info(`[migrate] applied ${migration.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    logger.info("[migrate] up to date");

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL statement_timeout = 0");
      const synced = await syncSystemExerciseImages(client);
      await client.query("COMMIT");
      if (synced.exercises > 0 || synced.sessionExercises > 0) {
        logger.info("[migrate] synced system exercise images", { ...synced });
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
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
      logger.error("[migrate] error", { error: serializeError(err) });
      process.exit(1);
    })
    .finally(() => pool?.end());
}
