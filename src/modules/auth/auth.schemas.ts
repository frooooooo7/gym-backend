import { z } from "zod";

/** bcrypt only uses the first 72 bytes — anything after them is ignored. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * Upper bound for passwords that are only checked (login, current password):
 * accounts created before the 72-byte rule must still be able to sign in,
 * but megabyte-long strings should not reach the hashing workers.
 */
const MAX_CHECKED_PASSWORD_LENGTH = 1024;

/**
 * Password strength rules shared by registration and change-password —
 * `password_too_short` (< 8 chars), `password_too_weak` (no uppercase
 * letter / no digit) or `password_too_long` (> 72 bytes in UTF-8, which
 * bcrypt would silently truncate).
 */
const withPasswordRules = (schema: z.ZodString) =>
  schema
    .min(8, "password_too_short")
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_PASSWORD_BYTES,
      "password_too_long",
    )
    .regex(/[A-Z]/, "password_too_weak")
    .regex(/[0-9]/, "password_too_weak");

export const registerSchema = z.object({
  email: z.string().email("invalid_email"),
  password: withPasswordRules(z.string()),
  firstName: z
    .string()
    .min(1, "missing_fields")
    .max(50)
    .transform((s) => s.trim()),
  lastName: z
    .string()
    .min(1, "missing_fields")
    .max(50)
    .transform((s) => s.trim()),
});

export const loginSchema = z.object({
  email: z.string().email("invalid_email"),
  password: z
    .string()
    .min(1, "missing_fields")
    .max(MAX_CHECKED_PASSWORD_LENGTH, "password_too_long"),
});

const requiredPassword = () =>
  z
    .string({ error: "missing_fields" })
    .min(1, "missing_fields")
    .max(MAX_CHECKED_PASSWORD_LENGTH, "password_too_long");

export const changePasswordSchema = z.object({
  currentPassword: requiredPassword(),
  newPassword: withPasswordRules(z.string({ error: "missing_fields" })),
});

export const deleteAccountSchema = z.object({
  password: requiredPassword(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
