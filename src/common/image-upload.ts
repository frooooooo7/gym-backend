import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { AppError } from "./errors.js";
import { logger, serializeError } from "./logger.js";
import { diskPathFromPublicUrl, safeUnlink } from "./uploads.js";

/** Largest accepted upload (before re-encoding). */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** Decompression-bomb guard: 40 MP is far beyond any phone photo. */
const MAX_INPUT_PIXELS = 40_000_000;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const OCTET_STREAM = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * Multer keeps the upload in memory (≤ 5 MB): nothing reaches the disk until
 * the controller has checked ownership and `sharp` has decoded the bytes, so
 * a rejected or failed request can never leave a file behind.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    // Flutter Web often sends application/octet-stream or an empty MIME —
    // the extension is enough here, the real check is decoding below.
    const ok = ALLOWED_MIME.has(mime) || (ALLOWED_EXT.has(ext) && OCTET_STREAM.has(mime));
    if (ok) cb(null, true);
    else cb(new Error("invalid_file"));
  },
});

/** Single-file multipart middleware; any multer error is a `400 invalid_file`. */
export const singleImageUpload =
  (field: string) => (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: "invalid_file" });
        return;
      }
      next();
    });
  };

/**
 * Decodes the upload and re-encodes it as WebP no larger than
 * `maxDimension` px on the longer side (EXIF orientation applied, metadata
 * dropped). Anything that is not a decodable JPEG/PNG/WebP is a
 * `400 invalid_file` — the stored file is always our own encoder output.
 */
export const toWebp = async (input: Buffer, maxDimension: number): Promise<Buffer> => {
  try {
    const image = sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    });
    const { format } = await image.metadata();
    if (format !== "jpeg" && format !== "png" && format !== "webp") {
      throw new Error(`unsupported format ${format}`);
    }
    return await image
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AppError(400, "invalid_file");
  }
};

export interface StoredImage {
  publicPath: string;
  diskPath: string;
}

/** Writes `bytes` as `<uuid>.webp` under the public prefix (e.g. `/uploads/avatars/`). */
export const storeImage = async (
  publicPrefix: string,
  bytes: Buffer,
): Promise<StoredImage> => {
  const publicPath = `${publicPrefix}${randomUUID()}.webp`;
  const diskPath = diskPathFromPublicUrl(publicPath);
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, bytes, { flag: "wx" });
  return { publicPath, diskPath };
};

/**
 * Best-effort removal of a file we manage under `publicPrefix`. Values that
 * point anywhere else (other prefixes, absolute URLs) are ignored; only the
 * basename is used, so `..` segments cannot escape the directory.
 */
export const removeManagedImage = async (
  publicUrl: string | null | undefined,
  publicPrefix: string,
): Promise<void> => {
  if (!publicUrl || !publicUrl.startsWith(publicPrefix)) return;
  const fileName = path.basename(publicUrl);
  try {
    await safeUnlink(diskPathFromPublicUrl(`${publicPrefix}${fileName}`));
  } catch (e: unknown) {
    logger.warn("[uploads] failed to remove file", {
      publicUrl,
      error: serializeError(e),
    });
  }
};

/** Removes a file this request just stored (after a failed DB update). */
export const discardStoredImage = async (stored: StoredImage): Promise<void> => {
  try {
    await safeUnlink(stored.diskPath);
  } catch (e: unknown) {
    logger.warn("[uploads] failed to remove uploaded file", {
      diskPath: stored.diskPath,
      error: serializeError(e),
    });
  }
};
