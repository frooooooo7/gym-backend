import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AppError } from "../../common/errors.js";
import { requirePool } from "../../db/require-pool.js";
import type { TrainingSessionBodyInput } from "./training-sessions.schemas.js";

export interface TrainingSessionHistoryFilters {
  limit: number;
  cursor?: { startedAt: string; id: string };
  updatedSince?: Date;
}

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
  actual_tempo: string | null;
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
  shared_to_profile: boolean;
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
  if (exercises.length === 0) return;

  const exerciseIds = exercises.map(() => randomUUID());
  const exerciseValueClauses: string[] = [];
  const exerciseParams: unknown[] = [];
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    const offset = exerciseIndex * 10;
    exerciseValueClauses.push(
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}, $${offset + 4}::uuid, $${offset + 5}::uuid, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`,
    );
    exerciseParams.push(
      exerciseIds[exerciseIndex],
      exercise.clientId ?? null,
      sessionId,
      exercise.exerciseId ?? null,
      exercise.exerciseClientId ?? null,
      exercise.exerciseName,
      exercise.exerciseMuscles,
      exercise.exerciseCategory,
      trimOrNull(exercise.exerciseImageUrl),
      exercise.position ?? exerciseIndex,
    );
  }
  await client.query(
    `INSERT INTO training_session_exercises
      (id, client_id, session_id, exercise_id, exercise_client_id, exercise_name,
       exercise_muscles, exercise_category, exercise_image_url, position)
     VALUES ${exerciseValueClauses.join(", ")}`,
    exerciseParams,
  );

  const setValueClauses: string[] = [];
  const setParams: unknown[] = [];
  let setOrdinal = 0;
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    const sessionExerciseId = exerciseIds[exerciseIndex];
    const sets = [...exercise.sets].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    for (const [setIndex, set] of sets.entries()) {
      const offset = setOrdinal * 13;
      setValueClauses.push(
        `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`,
      );
      setParams.push(
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
        trimOrNull(set.actualTempo),
        set.completed,
        set.completedAt ?? null,
      );
      setOrdinal += 1;
    }
  }
  if (setValueClauses.length === 0) return;

  await client.query(
    `INSERT INTO training_session_sets
      (client_id, session_exercise_id, position, planned_weight, planned_reps,
       planned_rir, planned_tempo, actual_weight, actual_reps, actual_rir,
       actual_tempo, completed, completed_at)
     VALUES ${setValueClauses.join(", ")}`,
    setParams,
  );
};

/**
 * Sesja to migawka treningu: ćwiczenie albo plan usunięte, zanim klient
 * offline zdążył ją wysłać, nie może blokować zapisu na zawsze. Niewidoczne
 * referencje zapisujemy jako NULL — tak samo, jak zrobiłby to
 * `ON DELETE SET NULL`, gdyby sesja dotarła wcześniej. Nazwa ćwiczenia,
 * mięśnie i nazwa planu zostają w snapshotcie, a cudzych zasobów nadal nie
 * da się podpiąć.
 */
const withVisibleReferences = async (
  client: PoolClient,
  userId: string,
  body: TrainingSessionBodyInput,
): Promise<TrainingSessionBodyInput> => {
  const ids = [
    ...new Set(
      body.exercises
        .map((exercise) => exercise.exerciseId)
        .filter((id): id is string => !!id),
    ),
  ];

  let visibleIds = new Set<string>();
  if (ids.length > 0) {
    const { rows } = await client.query(
      `SELECT id FROM exercises
       WHERE id = ANY($1::uuid[]) AND (is_system = true OR created_by = $2)`,
      [ids, userId],
    );
    visibleIds = new Set(rows.map((row) => row.id as string));
  }

  let planId = body.planId ?? null;
  if (planId) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM training_plans WHERE id = $1 AND user_id = $2",
      [planId, userId],
    );
    if (!rowCount) planId = null;
  }

  return {
    ...body,
    planId,
    exercises: body.exercises.map((exercise) => ({
      ...exercise,
      exerciseId:
        exercise.exerciseId && visibleIds.has(exercise.exerciseId)
          ? exercise.exerciseId
          : null,
    })),
  };
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

/**
 * Serialises writes that address a session by `(user, clientId)` — the POST
 * upsert and both deletes — so a create racing a delete cannot slip in between
 * the tombstone check and the insert. Released at COMMIT/ROLLBACK.
 */
const lockClientId = async (
  client: PoolClient,
  userId: string,
  clientId: string,
) => {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`training_session:${userId}:${clientId.toLowerCase()}`],
  );
};

const isTombstoned = async (
  client: PoolClient,
  userId: string,
  { sessionId, clientId }: { sessionId?: string; clientId?: string | null },
): Promise<boolean> => {
  const { rowCount } = await client.query(
    `SELECT 1
     FROM training_session_tombstones
     WHERE user_id = $1
       AND (session_id = $2::uuid OR client_id = $3::uuid)
     LIMIT 1`,
    [userId, sessionId ?? null, clientId ?? null],
  );
  return !!rowCount;
};

const sessionDeleted = () => new AppError(410, "session_deleted");

export interface TrainingSessionTombstoneRow {
  session_id: string;
  client_id: string | null;
  deleted_at: Date;
}

export type DeleteSessionResult = "deleted" | "already_deleted" | "not_found";

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
  limit?: number,
): Promise<TrainingSessionRow[]> => {
  const queryParams = [userId, ...params];
  const limitSql =
    limit === undefined ? "" : `LIMIT $${queryParams.push(limit)}`;
  const { rows: sessionRows } = await client.query(
    `SELECT id, client_id, user_id, plan_id, plan_client_id, plan_name, status,
            note, started_at, finished_at, shared_to_profile, created_at,
            updated_at
     FROM training_sessions
     WHERE user_id = $1 ${whereSql}
     ORDER BY started_at DESC, id DESC
     ${limitSql}`,
    queryParams,
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
            actual_reps, actual_rir, actual_tempo, completed, completed_at
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
  for (const row of exerciseRows as Omit<
    TrainingSessionExerciseRow,
    "sets"
  >[]) {
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
      await lockClientId(client, userId, body.clientId);
      if (await isTombstoned(client, userId, { clientId: body.clientId }))
        throw sessionDeleted();
      body = await withVisibleReferences(client, userId, body);
      await ensureNoOtherActiveSession(client, userId, body);
      const { rows } = await client.query(
        `INSERT INTO training_sessions
          (user_id, client_id, plan_id, plan_client_id, plan_name, status,
           note, started_at, finished_at, shared_to_profile)
         VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
         DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           plan_client_id = EXCLUDED.plan_client_id,
           plan_name = EXCLUDED.plan_name,
           status = EXCLUDED.status,
           note = EXCLUDED.note,
           started_at = EXCLUDED.started_at,
           finished_at = EXCLUDED.finished_at,
           shared_to_profile = EXCLUDED.shared_to_profile
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
          body.sharedToProfile,
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
      if (isUniqueViolation(e))
        throw new AppError(409, "active_session_exists");
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
      if (
        await isTombstoned(client, userId, {
          sessionId,
          clientId: body.clientId,
        })
      )
        throw sessionDeleted();
      body = await withVisibleReferences(client, userId, body);
      await ensureNoOtherActiveSession(client, userId, body, sessionId);
      const { rowCount } = await client.query(
        `UPDATE training_sessions
         SET plan_id = $1::uuid, plan_client_id = $2::uuid, plan_name = $3,
             status = $4, note = $5, started_at = $6, finished_at = $7,
             shared_to_profile = $8
         WHERE id = $9 AND user_id = $10`,
        [
          body.planId ?? null,
          body.planClientId ?? null,
          body.planName,
          body.status,
          body.note,
          body.startedAt,
          body.finishedAt ?? null,
          body.sharedToProfile,
          sessionId,
          userId,
        ],
      );
      if (!rowCount) {
        // A concurrent DELETE may have committed while we waited on the row
        // lock; READ COMMITTED lets this statement see its tombstone.
        if (await isTombstoned(client, userId, { sessionId }))
          throw sessionDeleted();
        await client.query("ROLLBACK");
        return null;
      }
      // Updates the existing row in place (id, kudos, comments survive);
      // only exercises/sets are replaced. updated_at is bumped by trigger.
      await replaceChildren(client, sessionId, body);
      const [row] = await loadSessions(client, userId, "AND id = $2", [
        sessionId,
      ]);
      await client.query("COMMIT");
      return row ?? null;
    } catch (e) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(e))
        throw new AppError(409, "active_session_exists");
      throw e;
    } finally {
      client.release();
    }
  },

  active: async (userId: string): Promise<TrainingSessionRow | null> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      const rows = await loadSessions(
        client,
        userId,
        "AND status = 'active'",
        [],
      );
      return rows[0] ?? null;
    } finally {
      client.release();
    }
  },

  setSharedToProfile: async (
    userId: string,
    sessionId: string,
    sharedToProfile: boolean,
  ): Promise<TrainingSessionRow | null> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE training_sessions
         SET shared_to_profile = $1
         WHERE id = $2 AND user_id = $3`,
        [sharedToProfile, sessionId, userId],
      );
      if (!rowCount) {
        if (await isTombstoned(client, userId, { sessionId }))
          throw sessionDeleted();
        await client.query("ROLLBACK");
        return null;
      }
      const [row] = await loadSessions(client, userId, "AND id = $2", [
        sessionId,
      ]);
      await client.query("COMMIT");
      return row ?? null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Hard-deletes the session (exercises, sets, kudos and comments cascade)
   * and leaves a tombstone in the same transaction.
   */
  remove: async (
    userId: string,
    sessionId: string,
  ): Promise<DeleteSessionResult> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: found } = await client.query(
        `SELECT client_id FROM training_sessions
         WHERE id = $1 AND user_id = $2`,
        [sessionId, userId],
      );
      const clientId = (found[0]?.client_id as string | null) ?? null;
      // Advisory lock before the row lock — same order as the POST upsert.
      if (clientId) await lockClientId(client, userId, clientId);

      const { rowCount } = found.length
        ? await client.query(
            `DELETE FROM training_sessions
             WHERE id = $1 AND user_id = $2`,
            [sessionId, userId],
          )
        : { rowCount: 0 };
      if (!rowCount) {
        const tombstoned = await isTombstoned(client, userId, { sessionId });
        await client.query("COMMIT");
        return tombstoned ? "already_deleted" : "not_found";
      }

      await client.query(
        `INSERT INTO training_session_tombstones (session_id, user_id, client_id)
         VALUES ($1, $2, $3::uuid)
         ON CONFLICT DO NOTHING`,
        [sessionId, userId, clientId],
      );
      await client.query("COMMIT");
      return "deleted";
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Deletes the user's session with this client id (if it reached the server)
   * and always leaves a `(user, clientId)` tombstone. Idempotent; an existing
   * tombstone keeps its original deleted_at.
   */
  removeByClientId: async (userId: string, clientId: string): Promise<void> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockClientId(client, userId, clientId);
      const { rows } = await client.query(
        `DELETE FROM training_sessions
         WHERE user_id = $1 AND client_id = $2::uuid
         RETURNING id`,
        [userId, clientId],
      );
      const sessionId = (rows[0]?.id as string | undefined) ?? randomUUID();
      await client.query(
        `INSERT INTO training_session_tombstones (session_id, user_id, client_id)
         VALUES ($1, $2, $3::uuid)
         ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
         DO NOTHING`,
        [sessionId, userId, clientId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  deletedSince: async (
    userId: string,
    since: Date,
  ): Promise<TrainingSessionTombstoneRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT session_id, client_id, deleted_at
       FROM training_session_tombstones
       WHERE user_id = $1 AND deleted_at > $2
       ORDER BY deleted_at, session_id`,
      [userId, since],
    );
    return rows as TrainingSessionTombstoneRow[];
  },

  history: async (
    userId: string,
    filters: TrainingSessionHistoryFilters,
  ): Promise<TrainingSessionRow[]> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      const clauses = ["AND status IN ('completed', 'cancelled')"];
      const params: unknown[] = [];

      if (filters.updatedSince) {
        params.push(filters.updatedSince);
        clauses.push(`AND updated_at > $${params.length + 1}`);
      }
      if (filters.cursor) {
        params.push(filters.cursor.startedAt);
        const startedAtParam = params.length + 1;
        params.push(filters.cursor.id);
        const idParam = params.length + 1;
        clauses.push(`AND (
          started_at < $${startedAtParam}::timestamptz
          OR (started_at = $${startedAtParam}::timestamptz AND id < $${idParam}::uuid)
        )`);
      }

      return await loadSessions(
        client,
        userId,
        clauses.join(" "),
        params,
        filters.limit + 1,
      );
    } finally {
      client.release();
    }
  },
};
