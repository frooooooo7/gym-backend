import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

const avatarImagesDir = path.join(process.cwd(), "uploads", "avatar-images");

export const ensureAvatarImagesDir = (): void => {
  fs.mkdirSync(avatarImagesDir, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureAvatarImagesDir();
    cb(null, avatarImagesDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const safeExt = allowed.includes(ext) ? ext : ".jpg";
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const allowedMime = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const avatarImageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

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

export const avatarPublicPathPrefix = "/uploads/avatar-images/";

export const isManagedAvatarPath = (avatarUrl: string | null): boolean =>
  avatarUrl != null && avatarUrl.startsWith(avatarPublicPathPrefix);

export const deleteManagedAvatarFile = (avatarUrl: string | null): void => {
  if (!isManagedAvatarPath(avatarUrl)) return;
  const filename = path.basename(avatarUrl!);
  const filePath = path.join(avatarImagesDir, filename);
  fs.promises.unlink(filePath).catch(() => {
    /* ignore missing files */
  });
};

export const deleteAvatarFile = async (filePath: string): Promise<void> => {
  await fs.promises.unlink(filePath).catch(() => {
    /* ignore missing files */
  });
};

