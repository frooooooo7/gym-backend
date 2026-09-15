import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

const avatarsDir = path.join(process.cwd(), "uploads", "avatars");

export const AVATARS_PUBLIC_PREFIX = "/uploads/avatars/";

export const ensureAvatarsDir = (): void => {
  fs.mkdirSync(avatarsDir, { recursive: true });
};

const storage = multer.diskStorage({
  destination: avatarsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const safeExt = allowed.includes(ext) ? ext : ".jpg";
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const allowedMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    // Flutter Web often sends application/octet-stream or an empty MIME — trust extension then.
    const mimeOk = allowedMime.has(mime);
    const extOk = allowedExt.has(ext);
    const permissiveOk =
      extOk &&
      (mime === "" ||
        mime === "application/octet-stream" ||
        mime === "binary/octet-stream");

    if (mimeOk || permissiveOk) {
      cb(null, true);
      return;
    }

    cb(new Error("invalid_file"));
  },
});
