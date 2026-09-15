import path from "node:path";
import jwt from "jsonwebtoken";
import { comparePassword, hashPassword } from "../../common/bcrypt-worker.js";
import { AppError } from "../../common/errors.js";
import { logger, serializeError } from "../../common/logger.js";
import { diskPathFromPublicUrl, safeUnlink } from "../../common/uploads.js";
import { env } from "../../config/env.js";
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
} from "./auth.schemas.js";
import { authRepository, type UserRow } from "./auth.repository.js";
import { primeTokenVersion } from "./token-version.store.js";

const SALT_ROUNDS = 12;
const TOKEN_TTL = "30d";

const AVATARS_PUBLIC_PREFIX = "/uploads/avatars/";
const EXERCISE_IMAGES_PUBLIC_PREFIX = "/uploads/exercise-images/";

export const DUMMY_HASH = await hashPassword(
  "__timing_guard_dummy__",
  SALT_ROUNDS,
);

/** `tv` = users.token_version at issue time; see requireAuth. */
const makeToken = (id: string, email: string, tokenVersion: number): string =>
  jwt.sign({ sub: id, email, tv: tokenVersion }, env.jwtSecret, {
    expiresIn: TOKEN_TTL,
  });

const formatUser = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
});

type AuthResponse = { token: string; user: ReturnType<typeof formatUser> };

const authResponse = (user: UserRow): AuthResponse => ({
  token: makeToken(user.id, user.email, Number(user.token_version ?? 0)),
  user: formatUser(user),
});

/** Best-effort: only files we manage under the given public prefix are touched. */
const removeManagedUpload = async (
  publicUrl: string | null,
  prefix: string,
): Promise<void> => {
  if (!publicUrl || !publicUrl.startsWith(prefix)) return;
  const fileName = path.basename(publicUrl);
  try {
    await safeUnlink(diskPathFromPublicUrl(`${prefix}${fileName}`));
  } catch (e: unknown) {
    logger.warn("[auth] failed to remove upload of deleted account", { publicUrl, error: serializeError(e) });
  }
};

/** The user vanished between requireAuth and this call — same as a revoked token. */
const tokenRevoked = () => new AppError(401, "token_revoked");

export const authService = {
  register: async (input: RegisterInput): Promise<AuthResponse> => {
    const { email, password, firstName, lastName } = input;
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await hashPassword(password, SALT_ROUNDS);

    const user = await authRepository.createUser(
      normalizedEmail,
      passwordHash,
      firstName,
      lastName,
    );

    if (!user) {
      throw new AppError(409, "email_taken");
    }

    return authResponse(user);
  },

  login: async (input: LoginInput): Promise<AuthResponse> => {
    const normalizedEmail = input.email.toLowerCase();
    const user = await authRepository.findUserWithPasswordByEmail(
      normalizedEmail,
    );

    const hashToCompare = user?.password_hash ?? DUMMY_HASH;
    const valid = await comparePassword(input.password, hashToCompare);

    if (!user || !valid) {
      throw new AppError(401, "invalid_credentials");
    }

    return authResponse(user);
  },

  getMe: async (userId: string): Promise<ReturnType<typeof formatUser>> => {
    const user = await authRepository.findPublicUserById(userId);
    if (!user) {
      throw new AppError(404, "user_not_found");
    }
    return formatUser(user);
  },

  /** Revokes every other session; the returned token carries the new version. */
  changePassword: async (
    userId: string,
    input: ChangePasswordInput,
  ): Promise<AuthResponse> => {
    if (input.newPassword === input.currentPassword) {
      throw new AppError(400, "password_unchanged");
    }

    const user = await authRepository.findUserWithPasswordById(userId);
    if (!user) throw tokenRevoked();

    const valid = await comparePassword(input.currentPassword, user.password_hash);
    if (!valid) {
      throw new AppError(401, "invalid_credentials");
    }

    const newHash = await hashPassword(input.newPassword, SALT_ROUNDS);
    const updated = await authRepository.updatePasswordAndBumpTokenVersion(
      userId,
      user.password_hash,
      newHash,
    );
    if (!updated) {
      // Deleted meanwhile → revoked; password changed concurrently → the
      // current password we verified is no longer current.
      const stillExists = await authRepository.findPublicUserById(userId);
      if (!stillExists) throw tokenRevoked();
      throw new AppError(401, "invalid_credentials");
    }

    primeTokenVersion(userId, Number(updated.token_version));
    return authResponse(updated);
  },

  logoutAll: async (userId: string): Promise<AuthResponse> => {
    const updated = await authRepository.bumpTokenVersion(userId);
    if (!updated) throw tokenRevoked();
    primeTokenVersion(userId, Number(updated.token_version));
    return authResponse(updated);
  },

  deleteAccount: async (
    userId: string,
    input: DeleteAccountInput,
  ): Promise<void> => {
    const user = await authRepository.findUserWithPasswordById(userId);
    if (!user) throw tokenRevoked();

    const valid = await comparePassword(input.password, user.password_hash);
    if (!valid) {
      throw new AppError(401, "invalid_credentials");
    }

    const files = await authRepository.deleteUserCascade(userId);
    primeTokenVersion(userId, null);
    if (!files) throw tokenRevoked();

    await Promise.all([
      removeManagedUpload(files.avatarUrl, AVATARS_PUBLIC_PREFIX),
      ...files.exerciseImageUrls.map((url) =>
        removeManagedUpload(url, EXERCISE_IMAGES_PUBLIC_PREFIX),
      ),
    ]);
  },
};
