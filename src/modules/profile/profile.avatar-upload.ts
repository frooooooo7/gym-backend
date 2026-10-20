import fs from "node:fs";
import path from "node:path";

/** Public URL prefix of avatars (served from `uploads/avatars`). */
export const AVATARS_PUBLIC_PREFIX = "/uploads/avatars/";

/** Longer side of a stored avatar, in pixels (enough for 3× DPR at 128 dp). */
export const AVATAR_MAX_DIMENSION = 512;

const avatarsDir = path.join(process.cwd(), "uploads", "avatars");

export const ensureAvatarsDir = (): void => {
  fs.mkdirSync(avatarsDir, { recursive: true });
};
