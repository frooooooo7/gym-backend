import { z } from "zod";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const EARLIEST_DATE = "1900-01-01";

/** `YYYY-MM-DD` of [date] shifted by [days] (UTC). */
const isoDay = (date: Date, days = 0): string =>
  new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** True for a real calendar day in `YYYY-MM-DD` form. */
export const isRealIsoDate = (value: string): boolean => {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/**
 * The client's local calendar day. "Tomorrow" in UTC is still allowed:
 * east of UTC the local date runs up to 14 h ahead.
 */
const measuredOn = (code: string) =>
  z
    .string({ error: code })
    .refine(
      (value) =>
        isRealIsoDate(value) &&
        value >= EARLIEST_DATE &&
        value <= isoDay(new Date(), 1),
      code,
    );

export const bodyWeightDateParamsSchema = z.object({
  date: measuredOn("invalid_date"),
});

export const bodyWeightUpsertSchema = z.object({
  weightKg: z
    .number({ error: "invalid_weight" })
    .min(30, "invalid_weight")
    .max(300, "invalid_weight")
    .transform((kg) => Math.round(kg * 10) / 10),
});

const rangeBound = z
  .string({ error: "invalid_date_range" })
  .refine(isRealIsoDate, "invalid_date_range")
  .optional();

export const bodyWeightListQuerySchema = z
  .object({ from: rangeBound, to: rangeBound })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || from <= to,
    "invalid_date_range",
  );

export type BodyWeightUpsertInput = z.infer<typeof bodyWeightUpsertSchema>;
export type BodyWeightListQuery = z.infer<typeof bodyWeightListQuerySchema>;
