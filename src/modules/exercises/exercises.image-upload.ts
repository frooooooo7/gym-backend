import fs from "node:fs";
import path from "node:path";

/** Public URL prefix of user-uploaded exercise images (served from `uploads/`). */
export const EXERCISE_IMAGES_PUBLIC_PREFIX = "/uploads/exercise-images/";

/** Longer side of a stored exercise image, in pixels. */
export const EXERCISE_IMAGE_MAX_DIMENSION = 1024;

const exerciseImagesDir = path.join(process.cwd(), "uploads", "exercise-images");

export const ensureExerciseImagesDir = (): void => {
  fs.mkdirSync(exerciseImagesDir, { recursive: true });
};
