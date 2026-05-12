import { z } from "zod";
import { postgresUuid } from "../../common/schemas.js";

const optionalText = z
  .string()
  .max(2000)
  .optional()
  .nullable()
  .transform((s) => {
    const trimmed = s?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  });

const setSchema = z.object({
  clientId: postgresUuid.optional(),
  position: z.number().int().min(0).optional(),
  weight: z.string().max(40).optional().nullable(),
  reps: z.string().max(40).optional().default(""),
  rir: z.string().max(40).optional().nullable(),
  tempo: z.string().max(80).optional().nullable(),
});

const planExerciseSchema = z.object({
  clientId: postgresUuid.optional(),
  exerciseId: postgresUuid,
  position: z.number().int().min(0).optional(),
  sets: z.array(setSchema).min(1, "missing_sets"),
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
  exercises: z.array(planExerciseSchema).min(1, "missing_exercises"),
});

export type TrainingPlanBodyInput = z.infer<typeof trainingPlanBodySchema>;
