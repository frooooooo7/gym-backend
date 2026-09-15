import { z } from "zod";

/**
 * Password strength rules shared by registration and change-password —
 * `password_too_short` (< 8 chars) or `password_too_weak` (no uppercase
 * letter / no digit).
 */
const withPasswordRules = (schema: z.ZodString) =>
  schema
    .min(8, "password_too_short")
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
  password: z.string().min(1, "missing_fields"),
});

const requiredPassword = () =>
  z.string({ error: "missing_fields" }).min(1, "missing_fields");

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
