import { z } from "zod";

export const VALID_MUSCLES = [
  "chest",
  "back",
  "legs",
  "shoulders",
  "biceps",
  "triceps",
  "abs",
  "glutes",
] as const;

export const VALID_CATEGORIES = [
  "compound",
  "isolation",
  "cardio",
  "mobility",
  "plyometric",
  "calisthenics",
] as const;

export const VALID_FILTERS = ["all", "mine", "favourite", "recent"] as const;

export type ExerciseFilter = (typeof VALID_FILTERS)[number];

export const listQuerySchema = z.object({
  q: z.string().optional().default(""),
  muscle: z.enum(["all", ...VALID_MUSCLES]).optional().default("all"),
  filter: z.enum(VALID_FILTERS).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const upsertBodySchema = z.object({
  name: z
    .string()
    .min(1, "missing_name")
    .max(120)
    .transform((s) => s.trim()),
  muscles: z.array(z.enum(VALID_MUSCLES)).min(1, "missing_muscles"),
  category: z.enum(VALID_CATEGORIES, { message: "invalid_category" }),
});

export type ListQueryInput = z.infer<typeof listQuerySchema>;
export type UpsertBodyInput = z.infer<typeof upsertBodySchema>;

export const firstZodMessage = (issues: z.ZodIssue[]): string =>
  issues[0]?.message ?? "missing_fields";
