import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("invalid_email"),
  password: z
    .string()
    .min(8, "password_too_short")
    .regex(/[A-Z]/, "password_too_weak")
    .regex(/[0-9]/, "password_too_weak"),
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const firstZodMessage = (issues: z.ZodIssue[]): string => {
  const issue = issues[0];
  if (!issue) return "missing_fields";
  return issue.message;
};
