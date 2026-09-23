import type pg from "pg";

/**
 * Illustrations for the seeded system exercises: a grey 3D mannequin on the
 * app's dark background with the trained muscles highlighted in the body
 * highlighter blues. Generated with Gemini from free-exercise-db pose
 * references (https://github.com/yuhonas/free-exercise-db, Unlicense).
 *
 * Keys are system exercise ids (migration 003), values are file slugs in
 * `public/exercise-images/<slug>.webp`. `scripts/import-exercise-illustrations.ts`
 * converts the generated originals, and [syncSystemExerciseImages] points
 * the database at the current slugs on every API start — no migration
 * needed. Give a redrawn image a new slug so clients don't keep the cached
 * old one.
 */
export const SYSTEM_EXERCISE_IMAGES: Readonly<Record<string, string>> = {
  "a1000000-0000-0000-0000-000000000001": "bench-press",
  "a1000000-0000-0000-0000-000000000002": "pull-up",
  "a1000000-0000-0000-0000-000000000003": "barbell-squat",
  "a1000000-0000-0000-0000-000000000004": "dumbbell-shoulder-press",
  "a1000000-0000-0000-0000-000000000005": "deadlift",
  "a1000000-0000-0000-0000-000000000006": "dumbbell-curl",
  "a1000000-0000-0000-0000-000000000007": "dips",
  "a1000000-0000-0000-0000-000000000008": "barbell-row",
  "a1000000-0000-0000-0000-000000000009": "leg-press",
  "a1000000-0000-0000-0000-000000000010": "lateral-raise-v2",
  "a1000000-0000-0000-0000-000000000011": "triceps-pushdown",
  "a1000000-0000-0000-0000-000000000012": "plank-v2",
  "a1000000-0000-0000-0000-000000000013": "burpees",
  "a1000000-0000-0000-0000-000000000014": "forward-fold-stretch",
};

/** Public URL path the API serves the bundled images under. */
export const SYSTEM_EXERCISE_IMAGES_URL_PREFIX = "/static/exercise-images";

export const systemExerciseImageUrl = (slug: string): string =>
  `${SYSTEM_EXERCISE_IMAGES_URL_PREFIX}/${slug}.webp`;

export interface SystemExerciseImagesSyncResult {
  exercises: number;
  sessionExercises: number;
}

/**
 * Points system exercises at the current bundled illustrations and brings
 * session snapshots along. Idempotent — a no-op once in sync — so it runs on
 * every start. Only bundled (or empty) image URLs are replaced, so a manually
 * set image wins. Sessions whose snapshots change get their updated_at
 * bumped so clients pick them up through the `updatedSince` pull.
 *
 * Run inside a transaction without a statement timeout: the snapshot update
 * touches every past session of these exercises.
 */
export const syncSystemExerciseImages = async (
  client: Pick<pg.PoolClient, "query">,
): Promise<SystemExerciseImagesSyncResult> => {
  const entries = Object.entries(SYSTEM_EXERCISE_IMAGES);
  const params = [
    entries.map(([id]) => id),
    entries.map(([, slug]) => systemExerciseImageUrl(slug)),
    `${SYSTEM_EXERCISE_IMAGES_URL_PREFIX}/`,
  ];

  const exercises = await client.query(
    `UPDATE exercises e
        SET image_url = images.image_url
       FROM unnest($1::uuid[], $2::text[]) AS images (id, image_url)
      WHERE e.id = images.id
        AND e.is_system
        AND (e.image_url IS NULL OR starts_with(e.image_url, $3))
        AND e.image_url IS DISTINCT FROM images.image_url`,
    params,
  );

  const sessionExercises = await client.query(
    `WITH changed AS (
       UPDATE training_session_exercises tse
          SET exercise_image_url = e.image_url
         FROM exercises e
        WHERE tse.exercise_id = e.id
          AND e.id = ANY ($1::uuid[])
          AND starts_with(e.image_url, $2)
          AND (tse.exercise_image_url IS NULL
               OR starts_with(tse.exercise_image_url, $2))
          AND tse.exercise_image_url IS DISTINCT FROM e.image_url
       RETURNING tse.session_id
     ), touched AS (
       UPDATE training_sessions
          SET updated_at = now()
        WHERE id IN (SELECT session_id FROM changed)
     )
     SELECT count(*)::int AS count FROM changed`,
    [params[0], params[2]],
  );

  return {
    exercises: exercises.rowCount ?? 0,
    sessionExercises: (sessionExercises.rows[0]?.count as number) ?? 0,
  };
};
