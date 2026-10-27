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
  // 20–46: exercises from the training plan (migration 027), square originals.
  "a1000000-0000-0000-0000-000000000020": "handstand",
  "a1000000-0000-0000-0000-000000000021": "hspu-negative",
  "a1000000-0000-0000-0000-000000000022": "incline-dumbbell-fly",
  "a1000000-0000-0000-0000-000000000023": "overhead-triceps-extension",
  "a1000000-0000-0000-0000-000000000024": "muscle-up",
  "a1000000-0000-0000-0000-000000000025": "weighted-pull-up",
  "a1000000-0000-0000-0000-000000000026": "t-bar-row",
  "a1000000-0000-0000-0000-000000000027": "t-bar-row-chest-supported",
  "a1000000-0000-0000-0000-000000000028": "seated-cable-row",
  "a1000000-0000-0000-0000-000000000029": "face-pull",
  "a1000000-0000-0000-0000-000000000030": "barbell-curl",
  "a1000000-0000-0000-0000-000000000031": "hammer-curl",
  "a1000000-0000-0000-0000-000000000032": "front-lever",
  "a1000000-0000-0000-0000-000000000033": "romanian-deadlift",
  "a1000000-0000-0000-0000-000000000034": "leg-curl",
  "a1000000-0000-0000-0000-000000000035": "leg-extension",
  "a1000000-0000-0000-0000-000000000036": "calf-raise",
  "a1000000-0000-0000-0000-000000000037": "hanging-leg-raise",
  "a1000000-0000-0000-0000-000000000038": "ab-crunch-machine",
  "a1000000-0000-0000-0000-000000000039": "overhead-press",
  "a1000000-0000-0000-0000-000000000040": "reverse-fly",
  "a1000000-0000-0000-0000-000000000041": "preacher-curl",
  "a1000000-0000-0000-0000-000000000042": "skull-crusher",
  "a1000000-0000-0000-0000-000000000043": "rope-hammer-curl",
  "a1000000-0000-0000-0000-000000000044": "incline-dumbbell-press",
  "a1000000-0000-0000-0000-000000000045": "pec-deck-fly",
  "a1000000-0000-0000-0000-000000000046": "lat-pulldown",
  // 47–96: popular exercises (migration 028), 4:3 originals.
  "a1000000-0000-0000-0000-000000000047": "incline-barbell-bench-press",
  "a1000000-0000-0000-0000-000000000048": "dumbbell-bench-press",
  "a1000000-0000-0000-0000-000000000049": "push-up",
  "a1000000-0000-0000-0000-000000000050": "cable-crossover",
  "a1000000-0000-0000-0000-000000000051": "front-squat",
  "a1000000-0000-0000-0000-000000000052": "bulgarian-split-squat",
  "a1000000-0000-0000-0000-000000000053": "dumbbell-lunge",
  "a1000000-0000-0000-0000-000000000054": "hip-thrust",
  "a1000000-0000-0000-0000-000000000055": "one-arm-dumbbell-row",
  "a1000000-0000-0000-0000-000000000056": "chin-up",
  "a1000000-0000-0000-0000-000000000057": "hack-squat",
  "a1000000-0000-0000-0000-000000000058": "goblet-squat",
  "a1000000-0000-0000-0000-000000000059": "seated-leg-curl",
  "a1000000-0000-0000-0000-000000000060": "dumbbell-shrug",
  "a1000000-0000-0000-0000-000000000061": "arnold-press",
  "a1000000-0000-0000-0000-000000000062": "close-grip-bench-press",
  "a1000000-0000-0000-0000-000000000063": "seated-calf-raise",
  "a1000000-0000-0000-0000-000000000064": "crunch",
  "a1000000-0000-0000-0000-000000000065": "sumo-deadlift",
  "a1000000-0000-0000-0000-000000000066": "dumbbell-fly",
  "a1000000-0000-0000-0000-000000000067": "machine-chest-press",
  "a1000000-0000-0000-0000-000000000068": "kettlebell-swing",
  "a1000000-0000-0000-0000-000000000069": "ab-wheel-rollout",
  "a1000000-0000-0000-0000-000000000070": "russian-twist",
  "a1000000-0000-0000-0000-000000000071": "side-plank",
  "a1000000-0000-0000-0000-000000000072": "triceps-kickback",
  "a1000000-0000-0000-0000-000000000073": "concentration-curl",
  "a1000000-0000-0000-0000-000000000074": "cable-curl",
  "a1000000-0000-0000-0000-000000000075": "hip-abduction-machine",
  "a1000000-0000-0000-0000-000000000076": "good-morning",
  "a1000000-0000-0000-0000-000000000077": "bench-dip",
  "a1000000-0000-0000-0000-000000000078": "glute-bridge",
  "a1000000-0000-0000-0000-000000000079": "mountain-climber",
  "a1000000-0000-0000-0000-000000000080": "straight-arm-pulldown",
  "a1000000-0000-0000-0000-000000000081": "dumbbell-pullover",
  "a1000000-0000-0000-0000-000000000082": "hyperextension",
  "a1000000-0000-0000-0000-000000000083": "upright-row",
  "a1000000-0000-0000-0000-000000000084": "front-raise",
  "a1000000-0000-0000-0000-000000000085": "cable-lateral-raise",
  "a1000000-0000-0000-0000-000000000086": "decline-bench-press",
  "a1000000-0000-0000-0000-000000000087": "inverted-row",
  "a1000000-0000-0000-0000-000000000088": "step-up",
  "a1000000-0000-0000-0000-000000000089": "lying-leg-raise",
  "a1000000-0000-0000-0000-000000000090": "bicycle-crunch",
  "a1000000-0000-0000-0000-000000000091": "hip-adduction-machine",
  "a1000000-0000-0000-0000-000000000092": "farmers-walk",
  "a1000000-0000-0000-0000-000000000093": "box-jump",
  "a1000000-0000-0000-0000-000000000094": "cable-woodchopper",
  "a1000000-0000-0000-0000-000000000095": "machine-shoulder-press",
  "a1000000-0000-0000-0000-000000000096": "cable-glute-kickback",
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
