import { z } from "zod";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const postgresUuid = z
  .string()
  .regex(UUID_PATTERN, "invalid_uuid");

export const uuidParamsSchema = z.object({
  id: z.string().regex(UUID_PATTERN, "invalid_id"),
});

export const firstZodMessage = (issues: z.ZodIssue[]): string =>
  issues[0]?.message ?? "missing_fields";
