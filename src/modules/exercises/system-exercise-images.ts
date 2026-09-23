/**
 * Illustrations for the seeded system exercises: a grey 3D mannequin on the
 * app's dark background with the trained muscles highlighted in the body
 * highlighter blues. Generated with Gemini from free-exercise-db pose
 * references (https://github.com/yuhonas/free-exercise-db, Unlicense).
 *
 * Keys are system exercise ids (migration 003), values are file slugs in
 * `public/exercise-images/<slug>.webp`. `scripts/import-exercise-illustrations.ts`
 * converts the generated originals; migrations 016/017 point
 * `exercises.image_url` at them. Give a redrawn image a new slug so clients
 * don't keep the cached old one.
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

/** `(id, image_url)` rows for a SQL `VALUES` list. */
export const systemExerciseImageSqlValues = (): string =>
  Object.entries(SYSTEM_EXERCISE_IMAGES)
    .map(([id, slug]) => `('${id}'::uuid, '${systemExerciseImageUrl(slug)}')`)
    .join(",\n        ");
