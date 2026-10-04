import { requirePool } from "../../db/require-pool.js";
import type { Measurements } from "./body-measurements.schemas.js";

export interface BodyMeasurementsEntryRow {
  date: string;
  waist_cm: number | null;
  chest_cm: number | null;
  hips_cm: number | null;
  neck_cm: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
  calf_cm: number | null;
  body_fat_pct: number | null;
}

const ENTRY_COLUMNS = `to_char(measured_on, 'YYYY-MM-DD') AS date,
  waist_cm::float8 AS waist_cm,
  chest_cm::float8 AS chest_cm,
  hips_cm::float8 AS hips_cm,
  neck_cm::float8 AS neck_cm,
  arm_cm::float8 AS arm_cm,
  thigh_cm::float8 AS thigh_cm,
  calf_cm::float8 AS calf_cm,
  body_fat_pct::float8 AS body_fat_pct`;

export const bodyMeasurementsRepository = {
  /** The newest [limit] entries, returned oldest first. */
  listByUser: async (
    userId: string,
    limit: number,
  ): Promise<BodyMeasurementsEntryRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT ${ENTRY_COLUMNS}
         FROM body_measurement_entries
         WHERE user_id = $1
         ORDER BY measured_on DESC
         LIMIT $2
       ) newest
       ORDER BY date ASC`,
      [userId, limit],
    );
    return rows as BodyMeasurementsEntryRow[];
  },

  /** Creates or replaces the whole entry for [date]. */
  upsert: async (
    userId: string,
    date: string,
    values: Measurements,
  ): Promise<BodyMeasurementsEntryRow> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `INSERT INTO body_measurement_entries (
         user_id, measured_on, waist_cm, chest_cm, hips_cm, neck_cm,
         arm_cm, thigh_cm, calf_cm, body_fat_pct
       )
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, measured_on) DO UPDATE SET
         waist_cm = EXCLUDED.waist_cm,
         chest_cm = EXCLUDED.chest_cm,
         hips_cm = EXCLUDED.hips_cm,
         neck_cm = EXCLUDED.neck_cm,
         arm_cm = EXCLUDED.arm_cm,
         thigh_cm = EXCLUDED.thigh_cm,
         calf_cm = EXCLUDED.calf_cm,
         body_fat_pct = EXCLUDED.body_fat_pct,
         updated_at = now()
       RETURNING ${ENTRY_COLUMNS}`,
      [
        userId,
        date,
        values.waistCm,
        values.chestCm,
        values.hipsCm,
        values.neckCm,
        values.armCm,
        values.thighCm,
        values.calfCm,
        values.bodyFatPct,
      ],
    );
    return rows[0] as BodyMeasurementsEntryRow;
  },

  /** Removes the entry for [date]; returns whether one existed. */
  delete: async (userId: string, date: string): Promise<boolean> => {
    const pool = requirePool();
    const { rowCount } = await pool.query(
      `DELETE FROM body_measurement_entries
       WHERE user_id = $1 AND measured_on = $2::date`,
      [userId, date],
    );
    return (rowCount ?? 0) > 0;
  },
};
