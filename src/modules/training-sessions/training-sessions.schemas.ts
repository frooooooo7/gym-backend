import { z } from "zod";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cursorPayloadSchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  id: z.string().regex(UUID_PATTERN, "invalid_cursor"),
});

export const trainingSessionIdParamsSchema = z.object({
  sessionId: z.string().regex(UUID_PATTERN, "invalid_session_id"),
});

const statusSchema = z.enum(["completed", "cancelled", "active"]);

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

export const trainingSessionsListQuerySchema = z
  .object({
    cursor: z.string().optional().transform((value) => emptyToUndefined(value)),
    limit: z.coerce.number().int().min(1, "invalid_limit").max(50, "invalid_limit").default(20),
    status: statusSchema.optional(),
    planId: z.string().regex(UUID_PATTERN, "invalid_plan_id").optional(),
    q: z
      .string()
      .optional()
      .transform((value) => emptyToUndefined(value))
      .transform((value) => (value ? value.slice(0, 200) : undefined)),
    from: optionalDateQuery,
    to: optionalDateQuery,
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_date_range",
        path: ["from"],
      });
    }
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

export type TrainingSessionsListQuery = z.infer<typeof trainingSessionsListQuerySchema>;

export const decodeCursor = (
  cursor: string | undefined,
): { startedAt: string; id: string } | undefined => {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return cursorPayloadSchema.parse(JSON.parse(decoded));
};

export const encodeCursor = (startedAt: Date, id: string): string =>
  Buffer.from(
    JSON.stringify({
      startedAt: startedAt.toISOString(),
      id,
    }),
    "utf8",
  ).toString("base64url");

