import { requirePool } from "../../db/require-pool.js";
import type { ListQueryInput } from "./exercises.schemas.js";

export interface ExerciseRow {
  id: string;
  name: string;
  muscles: string[];
  category: string;
  created_by: string | null;
  created_at: Date;
  is_favourite: boolean;
}

export type ExerciseRowSansFavourite = Omit<ExerciseRow, "is_favourite">;

export const exercisesRepository = {
  list: async (
    userId: string,
    query: ListQueryInput,
  ): Promise<ExerciseRow[]> => {
    const pool = requirePool();
    const { q, muscle, filter, limit, offset } = query;
    const params: unknown[] = [userId];
    const conditions: string[] = [];

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`lower(e.name) LIKE $${params.length}`);
    }

    if (muscle !== "all") {
      params.push(muscle);
      conditions.push(`$${params.length} = ANY(e.muscles)`);
    }

    switch (filter) {
      case "mine":
        conditions.push(`e.created_by = $1`);
        break;
      case "favourite":
        conditions.push(`ufe.user_id IS NOT NULL`);
        break;
      case "recent":
        conditions.push(`e.created_at > now() - INTERVAL '30 days'`);
        break;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit, offset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    const sql = `
      SELECT
        e.id,
        e.name,
        e.muscles,
        e.category,
        e.created_by,
        e.created_at,
        (ufe.user_id IS NOT NULL) AS is_favourite
      FROM exercises e
      LEFT JOIN user_favourite_exercises ufe
        ON ufe.exercise_id = e.id AND ufe.user_id = $1
      ${where}
      ORDER BY e.name
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const { rows } = await pool.query(sql, params);
    return rows as ExerciseRow[];
  },

  insert: async (
    name: string,
    muscles: string[],
    category: string,
    userId: string,
  ): Promise<ExerciseRowSansFavourite> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `INSERT INTO exercises (name, muscles, category, is_system, created_by)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, name, muscles, category, created_by, created_at`,
      [name, muscles, category, userId],
    );
    return rows[0] as ExerciseRowSansFavourite;
  },

  update: async (
    name: string,
    muscles: string[],
    category: string,
    exerciseId: string,
    userId: string,
  ): Promise<ExerciseRowSansFavourite | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE exercises
       SET name = $1, muscles = $2, category = $3
       WHERE id = $4 AND created_by = $5
       RETURNING id, name, muscles, category, created_by, created_at`,
      [name, muscles, category, exerciseId, userId],
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0] as ExerciseRowSansFavourite;
  },

  deleteIfOwned: async (
    exerciseId: string,
    userId: string,
  ): Promise<boolean> => {
    const pool = requirePool();
    const { rowCount } = await pool.query(
      "DELETE FROM exercises WHERE id = $1 AND created_by = $2",
      [exerciseId, userId],
    );
    return !!rowCount;
  },

  exerciseExists: async (exerciseId: string): Promise<boolean> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      "SELECT id FROM exercises WHERE id = $1",
      [exerciseId],
    );
    return rows.length > 0;
  },

  insertFavouriteIfAbsent: async (
    userId: string,
    exerciseId: string,
  ): Promise<number> => {
    const pool = requirePool();
    const { rowCount } = await pool.query(
      `INSERT INTO user_favourite_exercises (user_id, exercise_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, exercise_id) DO NOTHING`,
      [userId, exerciseId],
    );
    return rowCount ?? 0;
  },

  deleteFavourite: async (
    userId: string,
    exerciseId: string,
  ): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      "DELETE FROM user_favourite_exercises WHERE user_id = $1 AND exercise_id = $2",
      [userId, exerciseId],
    );
  },

  hasFavourite: async (
    userId: string,
    exerciseId: string,
  ): Promise<boolean> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      "SELECT 1 FROM user_favourite_exercises WHERE user_id = $1 AND exercise_id = $2",
      [userId, exerciseId],
    );
    return rows.length > 0;
  },
};
