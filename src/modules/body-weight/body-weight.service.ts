import { AppError } from "../../common/errors.js";
import { isForeignKeyViolation } from "../../common/pg-errors.js";
import {
  bodyWeightRepository,
  type BodyWeightEntryRow,
} from "./body-weight.repository.js";

const formatEntry = (row: BodyWeightEntryRow) => ({
  date: row.date,
  weightKg: row.weight_kg,
});

export const bodyWeightService = {
  list: async (userId: string, limit: number) => {
    const rows = await bodyWeightRepository.listByUser(userId, limit);
    return { entries: rows.map(formatEntry) };
  },

  upsert: async (userId: string, date: string, weightKg: number) => {
    try {
      const row = await bodyWeightRepository.upsert(userId, date, weightKg);
      return formatEntry(row);
    } catch (e: unknown) {
      // Account deleted between auth and the insert.
      if (isForeignKeyViolation(e)) throw new AppError(404, "user_not_found");
      throw e;
    }
  },

  delete: async (userId: string, date: string): Promise<void> => {
    const deleted = await bodyWeightRepository.delete(userId, date);
    if (!deleted) throw new AppError(404, "entry_not_found");
  },
};
