import { requirePool } from "../../db/require-pool.js";
import type { ListQueryInput } from "./exercises.schemas.js";

export interface ExerciseRow {
  id: string;
  name: string;
  muscles: string[];
  category: string;
  description: string;
  image_url: string | null;
  created_by: string | null;
  created_at: Date;
  is_favourite: boolean;
}

export type ExerciseRowSansFavourite = Omit<ExerciseRow, "is_favourite">;

export type OwnedExerciseImageMeta =
  | { owned: false }
  | { owned: true; imageUrl: string | null };

export const exercisesRepository = {
  list: async (
    userId: string,
    query: ListQueryInput,
  ): Promise<ExerciseRow[]> => {
    const pool = requirePool();
    const { q, muscle, filter, limit, offset } = query;
    const params: unknown[] = [userId];
    const conditions: string[] = [
      "(e.is_system = true OR e.created_by = $1)",
    ];

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

    const where = `WHERE ${conditions.join(" AND ")}`;

    params.push(limit, offset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    const sql = `
      SELECT
        e.id,
        e.name,
        e.muscles,
        e.category,
        e.description,
        e.image_url,
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

  /**
   * Inserts a user-owned exercise. When `clientId` is set, insert is idempotent per user:
   * same `created_by` + `client_id` updates body fields and returns the same row.
   * `created` is false when an existing row was updated by conflict resolution.
   */
  insertUserExercise: async (
    name: string,
    muscles: string[],
    category: string,
    description: string,
    userId: string,
    clientId: string | undefined,
  ): Promise<{ row: ExerciseRowSansFavourite; created: boolean }> => {
    const pool = requirePool();

    if (clientId) {
      const { rows } = await pool.query(
        `INSERT INTO exercises (name, muscles, category, is_system, created_by, description, client_id)
         VALUES ($1, $2, $3, false, $4, $5, $6::uuid)
         ON CONFLICT (created_by, client_id) WHERE client_id IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           muscles = EXCLUDED.muscles,
           category = EXCLUDED.category,
           description = EXCLUDED.description
         RETURNING id, name, muscles, category, description, image_url, created_by, created_at,
           (xmax = 0) AS inserted`,
        [name, muscles, category, userId, description, clientId],
      );
      const raw = rows[0] as ExerciseRowSansFavourite & { inserted: boolean };
      const { inserted, ...row } = raw;
      return { row: row as ExerciseRowSansFavourite, created: inserted };
    }

    const { rows } = await pool.query(
      `INSERT INTO exercises (name, muscles, category, is_system, created_by, description)
       VALUES ($1, $2, $3, false, $4, $5)
       RETURNING id, name, muscles, category, description, image_url, created_by, created_at`,
      [name, muscles, category, userId, description],
    );
    return { row: rows[0] as ExerciseRowSansFavourite, created: true };
  },

  update: async (
    name: string,
    muscles: string[],
    category: string,
    description: string,
    exerciseId: string,
    userId: string,
  ): Promise<ExerciseRowSansFavourite | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE exercises
       SET name = $1, muscles = $2, category = $3, description = $4
       WHERE id = $5 AND created_by = $6
       RETURNING id, name, muscles, category, description, image_url, created_by, created_at`,
      [name, muscles, category, description, exerciseId, userId],
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

  exerciseVisibleToUser: async (
    exerciseId: string,
    userId: string,
  ): Promise<boolean> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT id FROM exercises
       WHERE id = $1 AND (is_system = true OR created_by = $2)`,
      [exerciseId, userId],
    );
    return rows.length > 0;
  },

  getOwnedExerciseImageMeta: async (
    exerciseId: string,
    userId: string,
  ): Promise<OwnedExerciseImageMeta> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT image_url FROM exercises WHERE id = $1 AND created_by = $2`,
      [exerciseId, userId],
    );
    if (rows.length === 0) {
      return { owned: false };
    }
    return {
      owned: true,
      imageUrl: rows[0].image_url as string | null,
    };
  },

  updateExerciseImageUrl: async (
    exerciseId: string,
    userId: string,
    imageUrl: string,
  ): Promise<ExerciseRowSansFavourite | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE exercises SET image_url = $3
       WHERE id = $1 AND created_by = $2
       RETURNING id, name, muscles, category, description, image_url, created_by, created_at`,
      [exerciseId, userId, imageUrl],
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0] as ExerciseRowSansFavourite;
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
