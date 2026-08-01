import { requirePool } from "../../db/require-pool.js";

export interface TrainingHistoryListRow {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  duration_sec: number;
  status: "completed" | "cancelled" | "active";
  plan_id: string;
  plan_name: string;
  exercises_count: number;
  completed_sets_count: number;
  total_volume_kg: string | number | null;
  note: string | null;
  progress_type: string | null;
  progress_label: string | null;
  updated_at: Date;
}

export interface TrainingHistoryDetailRow {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  duration_sec: number;
  status: "completed" | "cancelled" | "active";
  plan_id: string;
  plan_name: string;
  note: string | null;
  updated_at: Date;
}

export interface TrainingHistoryExerciseRow {
  id: string;
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  exercise_muscles: string[];
  exercise_image_url: string | null;
  position: number;
}

export interface TrainingHistorySetRow {
  id: string;
  session_exercise_id: string;
  set_index: number;
  planned_weight_kg: string | null;
  planned_reps: string | number | null;
  planned_rir: string | number | null;
  planned_tempo: string | null;
  actual_weight_kg: string | null;
  actual_reps: string | number | null;
  actual_rir: string | number | null;
  actual_tempo: string | null;
  completed: boolean;
  completed_at: Date | null;
}

export interface TrainingHistoryListFilters {
  userId: string;
  limit: number;
  status?: "completed" | "cancelled" | "active";
  planId?: string;
  q?: string;
  from?: Date;
  to?: Date;
  cursor?: {
    startedAt: string;
    id: string;
  };
}

const BASE_LIST_SELECT = `
  SELECT
    ts.id,
    ts.started_at,
    ts.finished_at AS ended_at,
    COALESCE(
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(ts.finished_at, now()) - ts.started_at)))::int),
      0
    ) AS duration_sec,
    ts.status,
    ts.plan_id,
    ts.plan_name,
    COALESCE(ec.exercises_count, 0) AS exercises_count,
    COALESCE(sc.completed_sets_count, 0) AS completed_sets_count,
    COALESCE(sc.total_volume_kg, 0) AS total_volume_kg,
    ts.note,
    NULL::text AS progress_type,
    NULL::text AS progress_label,
    ts.updated_at
  FROM training_sessions ts
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS exercises_count
    FROM training_session_exercises tse
    WHERE tse.session_id = ts.id
  ) ec ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS completed_sets_count,
      -- actual_weight / actual_reps są TEXT-em (klient zapisuje surowy input),
      -- więc do sumy trafiają tylko wartości, które faktycznie są liczbą.
      COALESCE(SUM(
        CASE
          WHEN replace(btrim(tss.actual_weight), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
           AND btrim(tss.actual_reps) ~ '^[0-9]+$'
          THEN replace(btrim(tss.actual_weight), ',', '.')::numeric
               * btrim(tss.actual_reps)::numeric
          ELSE 0
        END
      ), 0)::float8 AS total_volume_kg
    FROM training_session_exercises tse
    JOIN training_session_sets tss ON tss.session_exercise_id = tse.id
    WHERE tse.session_id = ts.id AND tss.completed = true
  ) sc ON true
`;

export const trainingHistoryRepository = {
  list: async (filters: TrainingHistoryListFilters): Promise<TrainingHistoryListRow[]> => {
    const pool = requirePool();

    const where: string[] = ["ts.user_id = $1"];
    const params: unknown[] = [filters.userId];

    if (filters.status) {
      params.push(filters.status);
      where.push(`ts.status = $${params.length}`);
    }
    if (filters.planId) {
      params.push(filters.planId);
      where.push(`ts.plan_id = $${params.length}::uuid`);
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`ts.started_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`ts.started_at <= $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      const searchParam = `$${params.length}`;
      where.push(`(
        ts.plan_name ILIKE ${searchParam}
        OR EXISTS (
          SELECT 1
          FROM training_session_exercises tse
          WHERE tse.session_id = ts.id
            AND tse.exercise_name ILIKE ${searchParam}
        )
      )`);
    }
    if (filters.cursor) {
      params.push(filters.cursor.startedAt);
      const cursorStartedAtParam = `$${params.length}`;
      params.push(filters.cursor.id);
      const cursorIdParam = `$${params.length}`;
      where.push(`(
        ts.started_at < ${cursorStartedAtParam}::timestamptz
        OR (ts.started_at = ${cursorStartedAtParam}::timestamptz AND ts.id < ${cursorIdParam}::uuid)
      )`);
    }

    params.push(filters.limit + 1);
    const limitParam = `$${params.length}`;

    const sql = `
      ${BASE_LIST_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY ts.started_at DESC, ts.id DESC
      LIMIT ${limitParam}
    `;

    const { rows } = await pool.query(sql, params);
    return rows as TrainingHistoryListRow[];
  },

  findOneForUser: async (
    userId: string,
    sessionId: string,
  ): Promise<TrainingHistoryDetailRow | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `
      SELECT
        ts.id,
        ts.started_at,
        ts.finished_at AS ended_at,
        COALESCE(
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(ts.finished_at, now()) - ts.started_at)))::int),
          0
        ) AS duration_sec,
        ts.status,
        ts.plan_id,
        ts.plan_name,
        ts.note,
        ts.updated_at
      FROM training_sessions ts
      WHERE ts.id = $1::uuid AND ts.user_id = $2
      `,
      [sessionId, userId],
    );
    return (rows[0] as TrainingHistoryDetailRow | undefined) ?? null;
  },

  findExercises: async (sessionId: string): Promise<TrainingHistoryExerciseRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `
      SELECT
        tse.id,
        tse.session_id,
        tse.exercise_id,
        tse.exercise_name,
        tse.exercise_muscles,
        tse.exercise_image_url,
        tse.position
      FROM training_session_exercises tse
      WHERE tse.session_id = $1::uuid
      ORDER BY tse.position ASC, tse.id ASC
      `,
      [sessionId],
    );
    return rows as TrainingHistoryExerciseRow[];
  },

  findSets: async (sessionExerciseIds: string[]): Promise<TrainingHistorySetRow[]> => {
    if (sessionExerciseIds.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `
      SELECT
        id,
        session_exercise_id,
        position AS set_index,
        planned_weight AS planned_weight_kg,
        planned_reps,
        planned_rir,
        planned_tempo,
        actual_weight AS actual_weight_kg,
        actual_reps,
        actual_rir,
        actual_tempo,
        completed,
        completed_at
      FROM training_session_sets
      WHERE session_exercise_id = ANY($1::uuid[])
      ORDER BY position ASC, id ASC
      `,
      [sessionExerciseIds],
    );
    return rows as TrainingHistorySetRow[];
  },
};

