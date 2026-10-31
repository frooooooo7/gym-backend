import { AppError } from "../../common/errors.js";
import { requirePool } from "../../db/require-pool.js";
import { containsPattern } from "../../db/sql-fragments.js";
import { musclesMatchingFilter } from "./exercises.schemas.js";
import type {
  DistanceUnit,
  ListQueryInput,
  TrackingType,
} from "./exercises.schemas.js";

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
  tracking_type: TrackingType;
  distance_unit: DistanceUnit;
  /** Identyfikator nadany offline przez klienta — pozwala mu sparować wiersz po zgubionej odpowiedzi. */
  client_id?: string | null;
}

const isForeignKeyViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23503";

/** Tryb zapisu serii; `undefined` — domyślny przy tworzeniu, bez zmian przy edycji. */
export interface ExerciseTrackingInput {
  trackingType?: TrackingType;
  distanceUnit?: DistanceUnit;
}

const RETURNING_COLUMNS =
  "id, name, muscles, category, description, image_url, created_by, created_at, tracking_type, distance_unit";

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
      params.push(containsPattern(q.toLowerCase()));
      conditions.push(`lower(e.name) LIKE $${params.length}`);
    }

    if (muscle !== "all") {
      params.push(musclesMatchingFilter(muscle));
      conditions.push(`e.muscles && $${params.length}::text[]`);
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
        e.client_id,
        e.tracking_type,
        e.distance_unit,
        (ufe.user_id IS NOT NULL) AS is_favourite
      FROM exercises e
      LEFT JOIN user_favourite_exercises ufe
        ON ufe.exercise_id = e.id AND ufe.user_id = $1
      ${where}
      ORDER BY e.name, e.id
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
    tracking: ExerciseTrackingInput = {},
  ): Promise<{ row: ExerciseRowSansFavourite; created: boolean }> => {
    const pool = requirePool();
    const trackingType = tracking.trackingType ?? "weight_reps";
    const distanceUnit = tracking.distanceUnit ?? "km";

    if (clientId) {
      const { rows } = await pool.query(
        `INSERT INTO exercises (name, muscles, category, is_system, created_by, description, client_id,
                                tracking_type, distance_unit)
         VALUES ($1, $2, $3, false, $4, $5, $6::uuid, $7, $8)
         ON CONFLICT (created_by, client_id) WHERE client_id IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           muscles = EXCLUDED.muscles,
           category = EXCLUDED.category,
           description = EXCLUDED.description,
           tracking_type = EXCLUDED.tracking_type,
           distance_unit = EXCLUDED.distance_unit
         RETURNING ${RETURNING_COLUMNS}, client_id,
           (xmax = 0) AS inserted`,
        [
          name,
          muscles,
          category,
          userId,
          description,
          clientId,
          trackingType,
          distanceUnit,
        ],
      );
      const raw = rows[0] as ExerciseRowSansFavourite & { inserted: boolean };
      const { inserted, ...row } = raw;
      return { row: row as ExerciseRowSansFavourite, created: inserted };
    }

    const { rows } = await pool.query(
      `INSERT INTO exercises (name, muscles, category, is_system, created_by, description,
                              tracking_type, distance_unit)
       VALUES ($1, $2, $3, false, $4, $5, $6, $7)
       RETURNING ${RETURNING_COLUMNS}`,
      [name, muscles, category, userId, description, trackingType, distanceUnit],
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
    tracking: ExerciseTrackingInput = {},
  ): Promise<ExerciseRowSansFavourite | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE exercises
       SET name = $1, muscles = $2, category = $3, description = $4,
           tracking_type = COALESCE($7, tracking_type),
           distance_unit = COALESCE($8, distance_unit)
       WHERE id = $5 AND created_by = $6
       RETURNING ${RETURNING_COLUMNS}, client_id`,
      [
        name,
        muscles,
        category,
        description,
        exerciseId,
        userId,
        tracking.trackingType ?? null,
        tracking.distanceUnit ?? null,
      ],
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0] as ExerciseRowSansFavourite;
  },

  /**
   * Deletes the user's exercise. Returns the image it had (so the caller can
   * remove the file), or `null` when nothing was deleted.
   */
  deleteIfOwned: async (
    exerciseId: string,
    userId: string,
  ): Promise<{ imageUrl: string | null } | null> => {
    const pool = requirePool();
    try {
      const { rows, rowCount } = await pool.query(
        "DELETE FROM exercises WHERE id = $1 AND created_by = $2 RETURNING image_url",
        [exerciseId, userId],
      );
      if (!rowCount) return null;
      return { imageUrl: (rows[0]?.image_url as string | null | undefined) ?? null };
    } catch (e) {
      // training_plan_exercises.exercise_id ma ON DELETE RESTRICT — to nie jest
      // błąd serwera, tylko konflikt, który klient może pokazać użytkownikowi.
      if (isForeignKeyViolation(e)) throw new AppError(409, "exercise_in_use");
      throw e;
    }
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

  /**
   * Points the user's exercise at a new image and returns the row plus the
   * URL it replaced. The previous value is read under a row lock, so two
   * concurrent uploads each see the other's file and neither is orphaned.
   */
  replaceExerciseImageUrl: async (
    exerciseId: string,
    userId: string,
    imageUrl: string,
  ): Promise<{ row: ExerciseRowSansFavourite; previousImageUrl: string | null } | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `WITH prev AS (
         SELECT id, image_url FROM exercises
         WHERE id = $1 AND created_by = $2
         FOR UPDATE
       )
       UPDATE exercises e SET image_url = $3
       FROM prev
       WHERE e.id = prev.id
       RETURNING ${RETURNING_COLUMNS.split(", ").map((c) => `e.${c}`).join(", ")},
                 e.client_id, prev.image_url AS previous_image_url`,
      [exerciseId, userId, imageUrl],
    );
    if (rows.length === 0) {
      return null;
    }
    const { previous_image_url, ...row } = rows[0] as ExerciseRowSansFavourite & {
      previous_image_url: string | null;
    };
    return { row, previousImageUrl: previous_image_url ?? null };
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
