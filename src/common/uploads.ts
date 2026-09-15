import fs from "node:fs/promises";
import path from "node:path";

/**
 * Stored upload URLs are relative public paths like
 * `/uploads/exercise-images/<uuid>.jpg` or `/uploads/avatars/<uuid>.png`,
 * served statically from `<cwd>/uploads/...`.
 */
export const diskPathFromPublicUrl = (publicUrl: string): string =>
  path.join(process.cwd(), ...publicUrl.replace(/^\/+/, "").split("/"));

export const safeUnlink = async (absPath: string): Promise<void> => {
  try {
    await fs.unlink(absPath);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw e;
  }
};
