import { z } from "zod";
import { progressionSettingsSchema } from "../../common/progression.js";
import {
  colorKey,
  distanceMeters,
  durationSeconds,
  iconKey,
  postgresUuid,
  restSeconds,
  supersetGroup,
} from "../../common/schemas.js";

const optionalText = z
  .string()
  .max(2000)
  .optional()
  .nullable()
  .transform((s) => {
    const trimmed = s?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  });

export const PLAN_GOALS = ["strength", "hypertrophy", "endurance"] as const;

const setSchema = z.object({
  clientId: postgresUuid.optional(),
  position: z.number().int().min(0).optional(),
  weight: z.string().max(40).optional().nullable(),
  reps: z.string().max(40).optional().default(""),
  rir: z.string().max(40).optional().nullable(),
  tempo: z.string().max(80).optional().nullable(),
  durationSeconds: durationSeconds,
  distanceM: distanceMeters,
});

const planExerciseSchema = z.object({
  clientId: postgresUuid.optional(),
  exerciseId: postgresUuid,
  position: z.number().int().min(0).optional(),
  restSeconds: restSeconds,
  supersetGroup: supersetGroup,
  sets: z.array(setSchema).min(1, "missing_sets").max(50),
});

export const trainingPlanBodySchema = z.object({
  clientId: postgresUuid.optional(),
  name: z
    .string()
    .trim()
    .min(1, "missing_name")
    .max(120),
  note: optionalText,
  selectedDays: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .default([])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  exercises: z.array(planExerciseSchema).min(1, "missing_exercises").max(50),
  // Older clients send none of these — the column defaults apply.
  defaultRestSeconds: z
    .number()
    .int()
    .min(0, "invalid_rest_seconds")
    .max(1800, "invalid_rest_seconds")
    .optional()
    .default(120),
  colorKey: colorKey,
  iconKey: iconKey,
  goal: z.enum(PLAN_GOALS).optional().nullable(),
  progressionStepKg: z
    .number()
    .positive("invalid_progression_step")
    .max(20, "invalid_progression_step")
    .optional()
    .nullable(),
  // Brak pola (starszy klient) zostawia metodę planu; null = jak w ustawieniach.
  progression: progressionSettingsSchema.nullable().optional(),
  highlightPlanColor: z.boolean().optional().default(true),
  showRir: z.boolean().optional().default(true),
  showTempo: z.boolean().optional().default(true),
  // Brak pola (starszy klient) zostawia widoczność, jaka była.
  isPublic: z.boolean().optional(),
  // Miejsce planu na liście (0 = pierwszy); brak pola zostawia je bez zmian.
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

/** Kopia cudzego planu albo planu z posta; clientId robi ją idempotentną. */
export const copyPlanBodySchema = z.object({
  clientId: postgresUuid.optional(),
});

export type CopyPlanBodyInput = z.infer<typeof copyPlanBodySchema>;

export type TrainingPlanBodyInput = z.infer<typeof trainingPlanBodySchema>;
