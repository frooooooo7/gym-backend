import fs from "node:fs";
import path from "node:path";

/** Public URL prefix of workout post photos (served from `uploads/post-photos`). */
export const POST_PHOTOS_PUBLIC_PREFIX = "/uploads/post-photos/";

/** Longer side of a stored post photo, in pixels (full-width on a 3× phone). */
export const POST_PHOTO_MAX_DIMENSION = 1600;

export const postPhotosDir = path.join(process.cwd(), "uploads", "post-photos");

export const ensurePostPhotosDir = (): void => {
  fs.mkdirSync(postPhotosDir, { recursive: true });
};
