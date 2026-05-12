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

const nullableUuid = postgresUuid.optional().nullable();

const sessionSetSchema = z.object({
  clientId: postgresUuid.optional(),
  position: z.number().int().min(0).optional(),
  plannedWeight: z.string().max(40).optional().nullable(),
  plannedReps: z.string().max(40).optional().default(""),
  plannedRir: z.string().max(40).optional().nullable(),
  plannedTempo: z.string().max(80).optional().nullable(),
  actualWeight: z.string().max(40).optional().nullable(),
  actualReps: z.string().max(40).optional().nullable(),
  actualRir: z.string().max(40).optional().nullable(),
  completed: z.boolean().optional().default(false),
  completedAt: z.coerce.date().optional().nullable(),
});

const sessionExerciseSchema = z.object({
  clientId: postgresUuid.optional(),
  exerciseId: nullableUuid,
  exerciseClientId: nullableUuid,
  exerciseName: z.string().trim().min(1, "missing_exercise_name").max(200),
  exerciseMuscles: z.array(z.string().max(80)).default([]),
  exerciseCategory: z.string().trim().min(1).max(80),
  exerciseImageUrl: z.string().max(2000).optional().nullable(),
  position: z.number().int().min(0).optional(),
  sets: z.array(sessionSetSchema).min(1, "missing_sets"),
});

export const trainingSessionBodySchema = z.object({
  clientId: postgresUuid,
  planId: nullableUuid,
  planClientId: nullableUuid,
  planName: z.string().trim().min(1, "missing_plan_name").max(120),
  status: z.enum(["active", "completed", "cancelled"]),
  note: optionalText,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional().nullable(),
  exercises: z.array(sessionExerciseSchema).min(1, "missing_exercises"),
});

export type TrainingSessionBodyInput = z.infer<
  typeof trainingSessionBodySchema
>;
