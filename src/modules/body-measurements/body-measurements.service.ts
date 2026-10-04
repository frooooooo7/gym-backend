import { AppError } from "../../common/errors.js";
import { isForeignKeyViolation } from "../../common/pg-errors.js";
import {
  bodyMeasurementsRepository,
  type BodyMeasurementsEntryRow,
} from "./body-measurements.repository.js";
import type { Measurements } from "./body-measurements.schemas.js";

const formatEntry = (row: BodyMeasurementsEntryRow) => ({
  date: row.date,
  waistCm: row.waist_cm,
  chestCm: row.chest_cm,
  hipsCm: row.hips_cm,
  neckCm: row.neck_cm,
  armCm: row.arm_cm,
  thighCm: row.thigh_cm,
  calfCm: row.calf_cm,
  bodyFatPct: row.body_fat_pct,
});

export const bodyMeasurementsService = {
  list: async (userId: string, limit: number) => {
    const rows = await bodyMeasurementsRepository.listByUser(userId, limit);
    return { entries: rows.map(formatEntry) };
  },

  upsert: async (userId: string, date: string, values: Measurements) => {
    try {
      const row = await bodyMeasurementsRepository.upsert(userId, date, values);
      return formatEntry(row);
    } catch (e: unknown) {
      // Account deleted between auth and the insert.
      if (isForeignKeyViolation(e)) throw new AppError(404, "user_not_found");
      throw e;
    }
  },

  delete: async (userId: string, date: string): Promise<void> => {
    const deleted = await bodyMeasurementsRepository.delete(userId, date);
    if (!deleted) throw new AppError(404, "entry_not_found");
  },
};
