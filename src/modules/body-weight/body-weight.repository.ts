import { requirePool } from "../../db/require-pool.js";

export interface BodyWeightEntryRow {
  date: string;
  weight_kg: number;
}

const ENTRY_COLUMNS = `to_char(measured_on, 'YYYY-MM-DD') AS date,
  weight_kg::float8 AS weight_kg`;

/*
 * users.weight_kg is the "current weight" shown in profile details. Writes
 * below keep it equal to the newest entry, in the same statement. Data-
 * modifying CTEs all see the snapshot from before the statement, so "is
 * there a newer entry" is answered without the row being written.
 */
export const bodyWeightRepository = {
  /** The newest [limit] entries, returned oldest first. */
  listByUser: async (
    userId: string,
    limit: number,
  ): Promise<BodyWeightEntryRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT ${ENTRY_COLUMNS}
         FROM body_weight_entries
         WHERE user_id = $1
         ORDER BY measured_on DESC
         LIMIT $2
       ) newest
       ORDER BY date ASC`,
      [userId, limit],
    );
    return rows as BodyWeightEntryRow[];
  },

  /** Creates or replaces the entry for [date]. */
  upsert: async (
    userId: string,
    date: string,
    weightKg: number,
  ): Promise<BodyWeightEntryRow> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `WITH upserted AS (
         INSERT INTO body_weight_entries (user_id, measured_on, weight_kg)
         VALUES ($1, $2::date, $3)
         ON CONFLICT (user_id, measured_on)
           DO UPDATE SET weight_kg = EXCLUDED.weight_kg, updated_at = now()
         RETURNING ${ENTRY_COLUMNS}
       ),
       synced AS (
         UPDATE users SET weight_kg = $3
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM body_weight_entries
             WHERE user_id = $1 AND measured_on > $2::date
           )
         RETURNING 1
       )
       SELECT date, weight_kg FROM upserted`,
      [userId, date, weightKg],
    );
    return rows[0] as BodyWeightEntryRow;
  },

  /**
   * Removes the entry for [date]; returns whether one existed. Deleting the
   * newest entry moves the current weight back to the previous one; deleting
   * the only entry leaves the current weight as it was.
   */
  delete: async (userId: string, date: string): Promise<boolean> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `WITH deleted AS (
         DELETE FROM body_weight_entries
         WHERE user_id = $1 AND measured_on = $2::date
         RETURNING 1
       ),
       previous AS (
         SELECT weight_kg FROM body_weight_entries
         WHERE user_id = $1 AND measured_on < $2::date
         ORDER BY measured_on DESC
         LIMIT 1
       ),
       synced AS (
         UPDATE users SET weight_kg = (SELECT weight_kg FROM previous)
         WHERE id = $1
           AND EXISTS (SELECT 1 FROM deleted)
           AND EXISTS (SELECT 1 FROM previous)
           AND NOT EXISTS (
             SELECT 1 FROM body_weight_entries
             WHERE user_id = $1 AND measured_on > $2::date
           )
         RETURNING 1
       )
       SELECT count(*)::int AS deleted FROM deleted`,
      [userId, date],
    );
    return (rows[0]?.deleted ?? 0) > 0;
  },
};
