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

export const requiredDate = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return undefined;
  return new Date(value as any);
}, z.date());

export const optionalDate = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value as any);
}, z.date().nullable().optional());

/** Rest after a set (or after a superset round), in seconds; null = default. */
export const restSeconds = z
  .number()
  .int()
  .min(0, "invalid_rest_seconds")
  .max(1800, "invalid_rest_seconds")
  .optional()
  .nullable();

/** Superset letter shared by the exercises of one group (A, B…). */
export const supersetGroup = z
  .string()
  .regex(/^[A-Z]$/, "invalid_superset_group")
  .optional()
  .nullable();

/** Plan colour from the app's palette (`orange`, `sky`…); null = automatic. */
export const colorKey = z
  .string()
  .regex(/^[a-z]{1,24}$/, "invalid_color_key")
  .optional()
  .nullable();

/** Plan icon from the app's icon set (`bolt`, `heart`…); null = a letter. */
export const iconKey = z
  .string()
  .regex(/^[a-z_]{1,24}$/, "invalid_icon_key")
  .optional()
  .nullable();
