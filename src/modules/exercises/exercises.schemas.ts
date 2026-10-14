import { z } from "zod";
import { DISTANCE_UNITS, TRACKING_TYPES } from "../../common/schemas.js";

export { DISTANCE_UNITS, TRACKING_TYPES };

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

/** Co zapisuje seria ćwiczenia: ciężar × powt., same powtórzenia, czas albo czas + dystans. */
export type TrackingType = (typeof TRACKING_TYPES)[number];
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

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
  muscles: z.array(z.enum(VALID_MUSCLES)).min(1, "missing_muscles").max(20),
  category: z.enum(VALID_CATEGORIES, { message: "invalid_category" }),
  description: z
    .string()
    .max(2000)
    .optional()
    .default("")
    .transform((s) => s.trim()),
  clientId: z.string().uuid().optional(),
  // Starsze klienty nie wysyłają — przy edycji zostaje zapisana wartość.
  trackingType: z.enum(TRACKING_TYPES).optional(),
  distanceUnit: z.enum(DISTANCE_UNITS).optional(),
});

export type ListQueryInput = z.infer<typeof listQuerySchema>;
export type UpsertBodyInput = z.infer<typeof upsertBodySchema>;

