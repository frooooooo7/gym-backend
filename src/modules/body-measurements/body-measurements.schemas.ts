import { z } from "zod";
import { isValidMeasurementDay } from "../body-weight/body-weight.schemas.js";

/**
 * Measurement fields in API order. Circumferences are in centimetres,
 * bodyFatPct is a percentage. Each is rounded to 0.1.
 */
export const MEASUREMENT_FIELDS = [
  "waistCm",
  "chestCm",
  "hipsCm",
  "neckCm",
  "armCm",
  "thighCm",
  "calfCm",
  "bodyFatPct",
] as const;

export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];
export type Measurements = Record<MeasurementField, number | null>;

const roundTenth = (value: number) => Math.round(value * 10) / 10;

const optionalValue = (min: number, max: number) =>
  z
    .number({ error: "invalid_measurement" })
    .min(min, "invalid_measurement")
    .max(max, "invalid_measurement")
    .transform(roundTenth)
    .nullable()
    .optional()
    .transform((value) => value ?? null);

const circumference = () => optionalValue(10, 300);

export const bodyMeasurementsDateParamsSchema = z.object({
  date: z
    .string()
    .refine((value) => isValidMeasurementDay(value, new Date()), "invalid_date"),
});

export const bodyMeasurementsUpsertSchema = z
  .object({
    waistCm: circumference(),
    chestCm: circumference(),
    hipsCm: circumference(),
    neckCm: circumference(),
    armCm: circumference(),
    thighCm: circumference(),
    calfCm: circumference(),
    bodyFatPct: optionalValue(2, 75),
  })
  .refine(
    (values) => MEASUREMENT_FIELDS.some((field) => values[field] !== null),
    "no_measurements",
  );

export const bodyMeasurementsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(365),
});

export type BodyMeasurementsUpsertInput = z.infer<
  typeof bodyMeasurementsUpsertSchema
>;
export type BodyMeasurementsListQuery = z.infer<
  typeof bodyMeasurementsListQuerySchema
>;
