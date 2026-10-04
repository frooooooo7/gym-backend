import { requirePool } from "../../db/require-pool.js";

export interface BodyWeightEntryRow {
  /** `YYYY-MM-DD` */
  date: string;
  weight_kg: number;
  updated_at: Date;
}

const ENTRY_COLUMNS = `to_char(measured_on, 'YYYY-MM-DD') AS date,
  weight_kg::float8 AS weight_kg, updated_at`;

export const bodyWeightRepository = {
  list: async (
    userId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<BodyWeightEntryRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ${ENTRY_COLUMNS}
       FROM body_weight_entries
       WHERE user_id = $1
         AND ($2::date IS NULL OR measured_on >= $2::date)
         AND ($3::date IS NULL OR measured_on <= $3::date)
       ORDER BY measured_on ASC`,
      [userId, from ?? null, to ?? null],
    );
    return rows as BodyWeightEntryRow[];
  },

  /**
   * Insert or replace the entry for [date]. When no later entry exists, the
   * profile weight (`users.weight_kg`) follows it.
   */
  upsert: async (
    userId: string,
    date: string,
    weightKg: number,
  ): Promise<BodyWeightEntryRow> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `WITH entry AS (
         INSERT INTO body_weight_entries (user_id, measured_on, weight_kg)
         VALUES ($1, $2::date, $3)
         ON CONFLICT (user_id, measured_on)
         DO UPDATE SET weight_kg = EXCLUDED.weight_kg
         RETURNING ${ENTRY_COLUMNS}
       ), profile AS (
         UPDATE users SET weight_kg = $3
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM body_weight_entries
             WHERE user_id = $1 AND measured_on > $2::date
           )
         RETURNING id
       )
       SELECT date, weight_kg, updated_at FROM entry`,
      [userId, date, weightKg],
    );
    return rows[0] as BodyWeightEntryRow;
  },

  /**
   * Delete the entry for [date] (no-op when missing). Deleting the latest
   * entry moves the profile weight back to the one before it; deleting the
   * only entry leaves the profile weight as it is.
   */
  remove: async (userId: string, date: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `WITH removed AS (
         DELETE FROM body_weight_entries
         WHERE user_id = $1 AND measured_on = $2::date
         RETURNING measured_on
       ), previous AS (
         SELECT weight_kg FROM body_weight_entries
         WHERE user_id = $1 AND measured_on < $2::date
         ORDER BY measured_on DESC
         LIMIT 1
       )
       UPDATE users SET weight_kg = (SELECT weight_kg FROM previous)
       WHERE id = $1
         AND EXISTS (SELECT 1 FROM removed)
         AND EXISTS (SELECT 1 FROM previous)
         AND NOT EXISTS (
           SELECT 1 FROM body_weight_entries
           WHERE user_id = $1 AND measured_on > $2::date
         )`,
      [userId, date],
    );
  },
};
