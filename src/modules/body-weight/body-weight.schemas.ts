import { z } from "zod";

/** How far ahead of the server's UTC day a client's local date may be. */
const MAX_DAYS_AHEAD = 1;
const MIN_DATE = "1900-01-01";

/** `YYYY-MM-DD` that is a real calendar day, or null. */
const parseIsoDay = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

/**
 * A measurement day in the client's calendar. Up to one day after the
 * server's UTC today is accepted, since the client may be ahead of UTC.
 */
export const isValidMeasurementDay = (value: string, now: Date): boolean => {
  const date = parseIsoDay(value);
  if (!date || value < MIN_DATE) return false;
  const latest = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + MAX_DAYS_AHEAD,
  );
  return date.getTime() <= latest;
};

export const bodyWeightDateParamsSchema = z.object({
  date: z
    .string()
    .refine((value) => isValidMeasurementDay(value, new Date()), "invalid_date"),
});

export const bodyWeightUpsertSchema = z.object({
  weightKg: z
    .number({ error: "invalid_weight" })
    .min(30, "invalid_weight")
    .max(300, "invalid_weight")
    .transform((kg) => Math.round(kg * 10) / 10),
});

export const bodyWeightListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(365),
});

export type BodyWeightUpsertInput = z.infer<typeof bodyWeightUpsertSchema>;
export type BodyWeightListQuery = z.infer<typeof bodyWeightListQuerySchema>;
