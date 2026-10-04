import { AppError } from "../../common/errors.js";
import { isForeignKeyViolation } from "../../common/pg-errors.js";
import {
  bodyWeightRepository,
  type BodyWeightEntryRow,
} from "./body-weight.repository.js";

const formatEntry = (row: BodyWeightEntryRow) => ({
  date: row.date,
  weightKg: row.weight_kg,
  updatedAt: row.updated_at,
});

export const bodyWeightService = {
  list: async (userId: string, from?: string, to?: string) => {
    const rows = await bodyWeightRepository.list(userId, from, to);
    return { items: rows.map(formatEntry) };
  },

  upsert: async (userId: string, date: string, weightKg: number) => {
    const row = await bodyWeightRepository
      .upsert(userId, date, weightKg)
      .catch((e: unknown) => {
        // Account deleted mid-request.
        if (isForeignKeyViolation(e)) throw new AppError(404, "user_not_found");
        throw e;
      });
    return formatEntry(row);
  },

  remove: async (userId: string, date: string) => {
    await bodyWeightRepository.remove(userId, date);
  },
};
