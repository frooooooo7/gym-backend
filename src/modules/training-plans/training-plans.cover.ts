import fs from "node:fs";
import path from "node:path";

/** Public URL prefix of plan cover photos (served from `uploads/plan-covers`). */
export const PLAN_COVERS_PUBLIC_PREFIX = "/uploads/plan-covers/";

/** Longer side of a stored plan cover, in pixels (full-width header on a 3× phone). */
export const PLAN_COVER_MAX_DIMENSION = 1600;

export const planCoversDir = path.join(process.cwd(), "uploads", "plan-covers");

export const ensurePlanCoversDir = (): void => {
  fs.mkdirSync(planCoversDir, { recursive: true });
};
