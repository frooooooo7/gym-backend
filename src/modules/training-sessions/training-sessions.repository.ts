import type { PoolClient } from "pg";
import { AppError } from "../../common/errors.js";
import { requirePool } from "../../db/require-pool.js";
import type { TrainingSessionBodyInput } from "./training-sessions.schemas.js";

export interface TrainingSessionSetRow {
  id: string;
  client_id: string | null;
  session_exercise_id: string;
  position: number;
  planned_weight: string | null;
  planned_reps: string;
  planned_rir: string | null;
  planned_tempo: string | null;
  actual_weight: string | null;
  actual_reps: string | null;
  actual_rir: string | null;
  completed: boolean;
  completed_at: Date | null;
}

export interface TrainingSessionExerciseRow {
  id: string;
  client_id: string | null;
  session_id: string;
  exercise_id: string | null;
  exercise_client_id: string | null;
  exercise_name: string;
  exercise_muscles: string[];
  exercise_category: string;
  exercise_image_url: string | null;
  position: number;
  sets: TrainingSessionSetRow[];
}

export interface TrainingSessionRow {
  id: string;
  client_id: string | null;
  user_id: string;
  plan_id: string | null;
  plan_client_id: string | null;
  plan_name: string;
  status: "active" | "completed" | "cancelled";
  note: string | null;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
  exercises: TrainingSessionExerciseRow[];
}

const trimOrNull = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const replaceChildren = async (
  client: PoolClient,
  sessionId: string,
  body: TrainingSessionBodyInput,
) => {
  await client.query(
    "DELETE FROM training_session_exercises WHERE session_id = $1",
    [sessionId],
  );

  const exercises = [...body.exercises].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  for (const [exerciseIndex, exercise] of exercises.entries()) {
    const { rows } = await client.query(
      `INSERT INTO training_session_exercises
        (client_id, session_id, exercise_id, exercise_client_id, exercise_name,
         exercise_muscles, exercise_category, exercise_image_url, position)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        exercise.clientId ?? null,
        sessionId,
        exercise.exerciseId ?? null,
        exercise.exerciseClientId ?? null,
        exercise.exerciseName,
        exercise.exerciseMuscles,
        exercise.exerciseCategory,
        trimOrNull(exercise.exerciseImageUrl),
        exercise.position ?? exerciseIndex,
      ],
    );
    const sessionExerciseId = rows[0].id as string;
    const sets = [...exercise.sets].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    const valuesClauses: string[] = [];
    const params: unknown[] = [];
    for (const [setIndex, set] of sets.entries()) {
      const offset = setIndex * 12;
      valuesClauses.push(
        `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`,
      );
      params.push(
        set.clientId ?? null,
        sessionExerciseId,
        set.position ?? setIndex,
        trimOrNull(set.plannedWeight),
        set.plannedReps.trim(),
        trimOrNull(set.plannedRir),
        trimOrNull(set.plannedTempo),
        trimOrNull(set.actualWeight),
        trimOrNull(set.actualReps),
        trimOrNull(set.actualRir),
        set.completed,
        set.completedAt ?? null,
      );
    }
    await client.query(
      `INSERT INTO training_session_sets
        (client_id, session_exercise_id, position, planned_weight, planned_reps,
         planned_rir, planned_tempo, actual_weight, actual_reps, actual_rir,
         completed, completed_at)
       VALUES ${valuesClauses.join(", ")}`,
      params,
    );
  }
};

const ensurePlanOwned = async (
  client: PoolClient,
  userId: string,
  planId: string | null,
) => {
  if (!planId) return;
  const { rowCount } = await client.query(
    "SELECT 1 FROM training_plans WHERE id = $1 AND user_id = $2",
    [planId, userId],
  );
  if (!rowCount) throw new AppError(404, "plan_not_found_or_not_yours");
};

const ensureNoOtherActiveSession = async (
  client: PoolClient,
  userId: string,
  body: TrainingSessionBodyInput,
  sessionId?: string,
) => {
  if (body.status !== "active") return;
  const params: unknown[] = [userId, body.clientId ?? null];
  let excludeSql = "";
  if (sessionId) {
    params.push(sessionId);
    excludeSql = "AND id <> $3";
  }
  const { rowCount } = await client.query(
    `SELECT 1
     FROM training_sessions
     WHERE user_id = $1
       AND status = 'active'
       AND client_id IS DISTINCT FROM $2::uuid
       ${excludeSql}
     LIMIT 1`,
    params,
  );
  if (rowCount) throw new AppError(409, "active_session_exists");
};

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505";

const loadSessions = async (
  client: PoolClient,
  userId: string,
  whereSql: string,
  params: unknown[],
): Promise<TrainingSessionRow[]> => {
  const { rows: sessionRows } = await client.query(
    `SELECT id, client_id, user_id, plan_id, plan_client_id, plan_name, status,
            note, started_at, finished_at, created_at, updated_at
     FROM training_sessions
     WHERE user_id = $1 ${whereSql}
     ORDER BY started_at DESC, created_at DESC`,
    [userId, ...params],
  );
  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((r) => r.id as string);
  const { rows: exerciseRows } = await client.query(
    `SELECT id, client_id, session_id, exercise_id, exercise_client_id,
            exercise_name, exercise_muscles, exercise_category,
            exercise_image_url, position
     FROM training_session_exercises
     WHERE session_id = ANY($1::uuid[])
     ORDER BY position, id`,
    [sessionIds],
  );
  const exerciseIds = exerciseRows.map((r) => r.id as string);

  if (exerciseIds.length === 0) {
    return sessionRows.map(
      (row) =>
        ({
          ...row,
          exercises: [],
        }) as TrainingSessionRow,
    );
  }

  const { rows: setRows } = await client.query(
    `SELECT id, client_id, session_exercise_id, position, planned_weight,
            planned_reps, planned_rir, planned_tempo, actual_weight,
            actual_reps, actual_rir, completed, completed_at
     FROM training_session_sets
     WHERE session_exercise_id = ANY($1::uuid[])
     ORDER BY position, id`,
    [exerciseIds],
  );

  const setsByExercise = new Map<string, TrainingSessionSetRow[]>();
  for (const row of setRows as TrainingSessionSetRow[]) {
    const list = setsByExercise.get(row.session_exercise_id);
    if (list) list.push(row);
    else setsByExercise.set(row.session_exercise_id, [row]);
  }

  const exercisesBySession = new Map<string, TrainingSessionExerciseRow[]>();
  for (const row of exerciseRows as Omit<TrainingSessionExerciseRow, "sets">[]) {
    const entry = { ...row, sets: setsByExercise.get(row.id) ?? [] };
    const list = exercisesBySession.get(row.session_id);
    if (list) list.push(entry);
    else exercisesBySession.set(row.session_id, [entry]);
  }

  return sessionRows.map(
    (row) =>
      ({
        ...row,
        exercises: exercisesBySession.get(row.id as string) ?? [],
      }) as TrainingSessionRow,
  );
};

export const trainingSessionsRepository = {
  upsert: async (
    userId: string,
    body: TrainingSessionBodyInput,
  ): Promise<{ row: TrainingSessionRow; created: boolean }> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensurePlanOwned(client, userId, body.planId ?? null);
      await ensureNoOtherActiveSession(client, userId, body);
      const { rows } = await client.query(
        `INSERT INTO training_sessions
          (user_id, client_id, plan_id, plan_client_id, plan_name, status,
           note, started_at, finished_at)
         VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
         DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           plan_client_id = EXCLUDED.plan_client_id,
           plan_name = EXCLUDED.plan_name,
           status = EXCLUDED.status,
           note = EXCLUDED.note,
           started_at = EXCLUDED.started_at,
           finished_at = EXCLUDED.finished_at
         RETURNING id, (xmax = 0) AS inserted`,
        [
          userId,
          body.clientId,
          body.planId ?? null,
          body.planClientId ?? null,
          body.planName,
          body.status,
          body.note,
          body.startedAt,
          body.finishedAt ?? null,
        ],
      );
      const sessionId = rows[0].id as string;
      await replaceChildren(client, sessionId, body);
      const [row] = await loadSessions(client, userId, "AND id = $2", [
        sessionId,
      ]);
      if (!row) throw new AppError(404, "not_found_or_not_yours");
      await client.query("COMMIT");
      return { row, created: rows[0].inserted as boolean };
    } catch (e) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(e)) throw new AppError(409, "active_session_exists");
      throw e;
    } finally {
      client.release();
    }
  },

  update: async (
    userId: string,
    sessionId: string,
    body: TrainingSessionBodyInput,
  ): Promise<TrainingSessionRow | null> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensurePlanOwned(client, userId, body.planId ?? null);
      await ensureNoOtherActiveSession(client, userId, body, sessionId);
      const { rowCount } = await client.query(
        `UPDATE training_sessions
         SET plan_id = $1::uuid, plan_client_id = $2::uuid, plan_name = $3,
             status = $4, note = $5, started_at = $6, finished_at = $7
         WHERE id = $8 AND user_id = $9`,
        [
          body.planId ?? null,
          body.planClientId ?? null,
          body.planName,
          body.status,
          body.note,
          body.startedAt,
          body.finishedAt ?? null,
          sessionId,
          userId,
        ],
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      await replaceChildren(client, sessionId, body);
      const [row] = await loadSessions(client, userId, "AND id = $2", [
        sessionId,
      ]);
      await client.query("COMMIT");
      return row ?? null;
    } catch (e) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(e)) throw new AppError(409, "active_session_exists");
      throw e;
    } finally {
      client.release();
    }
  },

  active: async (userId: string): Promise<TrainingSessionRow | null> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      const rows = await loadSessions(client, userId, "AND status = 'active'", []);
      return rows[0] ?? null;
    } finally {
      client.release();
    }
  },

  history: async (userId: string): Promise<TrainingSessionRow[]> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      return await loadSessions(
        client,
        userId,
        "AND status IN ('completed', 'cancelled')",
        [],
      );
    } finally {
      client.release();
    }
  },
};
