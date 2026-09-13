import { z } from "zod";
import { postgresUuid, requiredDate, optionalDate } from "../../common/schemas.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cursorPayloadSchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  id: z.string().regex(UUID_PATTERN, "invalid_cursor"),
});

const emptyToUndefined = (value: string | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalDateQuery = z
  .string()
  .optional()
  .transform((value) => emptyToUndefined(value))
  .pipe(z.string().datetime({ offset: true }).optional())
  .transform((value) => (value ? new Date(value) : undefined));

export const decodeHistoryCursor = (
  cursor: string | undefined,
): { startedAt: string; id: string } | undefined => {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return cursorPayloadSchema.parse(JSON.parse(decoded));
};

export const encodeHistoryCursor = (startedAt: Date, id: string): string =>
  Buffer.from(
    JSON.stringify({
      startedAt: startedAt.toISOString(),
      id,
    }),
    "utf8",
  ).toString("base64url");

export const trainingSessionHistoryQuerySchema = z
  .object({
    cursor: z.string().optional().transform((value) => emptyToUndefined(value)),
    limit: z.coerce
      .number()
      .int()
      .min(1, "invalid_limit")
      .max(100, "invalid_limit")
      .default(50),
    updatedSince: optionalDateQuery,
  })
  .superRefine((value, ctx) => {
    if (!value.cursor) return;
    try {
      const decoded = Buffer.from(value.cursor, "base64url").toString("utf8");
      const parsed = JSON.parse(decoded) as unknown;
      cursorPayloadSchema.parse(parsed);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_cursor",
        path: ["cursor"],
      });
    }
  });

export type TrainingSessionHistoryQuery = z.infer<
  typeof trainingSessionHistoryQuerySchema
>;

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
  actualTempo: z.string().max(80).optional().nullable(),
  completed: z.boolean().optional().default(false),
  completedAt: z.coerce.date().optional().nullable(),
});

const sessionExerciseSchema = z.object({
  clientId: postgresUuid.optional(),
  exerciseId: nullableUuid,
  exerciseClientId: nullableUuid,
  exerciseName: z.string().trim().min(1, "missing_exercise_name").max(200),
  exerciseMuscles: z.array(z.string().max(80)).max(20).default([]),
  exerciseCategory: z.string().trim().min(1).max(80),
  exerciseImageUrl: z.string().max(2000).optional().nullable(),
  position: z.number().int().min(0).optional(),
  sets: z.array(sessionSetSchema).min(1, "missing_sets").max(50),
});

export const trainingSessionBodySchema = z.object({
  clientId: postgresUuid,
  planId: nullableUuid,
  planClientId: nullableUuid,
  planName: z.string().trim().min(1, "missing_plan_name").max(120),
  status: z.enum(["active", "completed", "cancelled"]),
  note: optionalText,
  startedAt: requiredDate,
  finishedAt: optionalDate,
  sharedToProfile: z.boolean().optional().default(false),
  exercises: z.array(sessionExerciseSchema).min(1, "missing_exercises").max(50),
});

export type TrainingSessionBodyInput = z.infer<
  typeof trainingSessionBodySchema
>;

export const sharedToProfileBodySchema = z.object({
  sharedToProfile: z.boolean(),
});

export type SharedToProfileBodyInput = z.infer<
  typeof sharedToProfileBodySchema
>;
