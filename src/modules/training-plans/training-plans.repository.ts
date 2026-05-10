import type { PoolClient } from "pg";
import { AppError } from "../../common/errors.js";
import { requirePool } from "../../db/require-pool.js";
import type { TrainingPlanBodyInput } from "./training-plans.schemas.js";

export interface TrainingPlanSetRow {
  id: string;
  client_id: string | null;
  plan_exercise_id: string;
  position: number;
  weight: string | null;
  reps: string;
  rir: string | null;
  tempo: string | null;
}

export interface TrainingPlanExerciseRow {
  id: string;
  client_id: string | null;
  plan_id: string;
  exercise_id: string;
  position: number;
  exercise_name: string;
  exercise_muscles: string[];
  exercise_category: string;
  exercise_description: string;
  exercise_image_url: string | null;
  sets: TrainingPlanSetRow[];
}

export interface TrainingPlanRow {
  id: string;
  client_id: string | null;
  user_id: string;
  name: string;
  note: string | null;
  selected_days: number[];
  created_at: Date;
  updated_at: Date;
  exercises: TrainingPlanExerciseRow[];
}

const assertExercisesVisible = async (
  client: PoolClient,
  userId: string,
  body: TrainingPlanBodyInput,
) => {
  const ids = [...new Set(body.exercises.map((e) => e.exerciseId))];
  const { rows } = await client.query(
    `SELECT id FROM exercises
     WHERE id = ANY($1::uuid[]) AND (is_system = true OR created_by = $2)`,
    [ids, userId],
  );
  if (rows.length !== ids.length) {
    throw new AppError(400, "exercise_not_found");
  }
};

const replaceChildren = async (
  client: PoolClient,
  planId: string,
  body: TrainingPlanBodyInput,
) => {
  await client.query("DELETE FROM training_plan_exercises WHERE plan_id = $1", [
    planId,
  ]);

  const exercises = [...body.exercises].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  for (const [exerciseIndex, exercise] of exercises.entries()) {
    const { rows } = await client.query(
      `INSERT INTO training_plan_exercises (client_id, plan_id, exercise_id, position)
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING id`,
      [
        exercise.clientId ?? null,
        planId,
        exercise.exerciseId,
        exercise.position ?? exerciseIndex,
      ],
    );
    const planExerciseId = rows[0].id as string;
    const sets = [...exercise.sets].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );

    if (sets.length === 0) continue;

    // Batch insert all sets for this exercise in a single query.
    const valuesClauses: string[] = [];
    const params: unknown[] = [];
    for (const [setIndex, set] of sets.entries()) {
      const offset = setIndex * 7;
      valuesClauses.push(
        `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
      );
      params.push(
        set.clientId ?? null,
        planExerciseId,
        set.position ?? setIndex,
        set.weight?.trim() || null,
        set.reps?.trim() ?? "",
        set.rir?.trim() || null,
        set.tempo?.trim() || null,
      );
    }
    await client.query(
      `INSERT INTO training_plan_sets
        (client_id, plan_exercise_id, position, weight, reps, rir, tempo)
       VALUES ${valuesClauses.join(", ")}`,
      params,
    );
  }
};

/**
 * Loads all plans for a user using only 3 queries (plans → exercises → sets)
 * instead of N+1 per plan.
 */
const loadPlansForUser = async (
  client: PoolClient,
  userId: string,
): Promise<TrainingPlanRow[]> => {
  const { rows: planRows } = await client.query(
    `SELECT id, client_id, user_id, name, note, selected_days, created_at, updated_at
     FROM training_plans
     WHERE user_id = $1
     ORDER BY updated_at DESC, created_at DESC`,
    [userId],
  );
  if (planRows.length === 0) return [];

  const planIds = planRows.map((r) => r.id as string);

  const { rows: exerciseRows } = await client.query(
    `SELECT
       tpe.id, tpe.client_id, tpe.plan_id, tpe.exercise_id, tpe.position,
       e.name AS exercise_name,
       e.muscles AS exercise_muscles,
       e.category AS exercise_category,
       e.description AS exercise_description,
       e.image_url AS exercise_image_url
     FROM training_plan_exercises tpe
     JOIN exercises e ON e.id = tpe.exercise_id
     WHERE tpe.plan_id = ANY($1::uuid[])
     ORDER BY tpe.position, tpe.id`,
    [planIds],
  );

  const exerciseIds = exerciseRows.map((r) => r.id as string);

  const { rows: setRows } = await client.query(
    `SELECT id, client_id, plan_exercise_id, position, weight, reps, rir, tempo
     FROM training_plan_sets
     WHERE plan_exercise_id = ANY($1::uuid[])
     ORDER BY position, id`,
    [exerciseIds.length > 0 ? exerciseIds : ["00000000-0000-0000-0000-000000000000"]],
  );

  // Group sets by plan_exercise_id
  const setsByExercise = new Map<string, TrainingPlanSetRow[]>();
  for (const row of setRows as TrainingPlanSetRow[]) {
    const list = setsByExercise.get(row.plan_exercise_id);
    if (list) {
      list.push(row);
    } else {
      setsByExercise.set(row.plan_exercise_id, [row]);
    }
  }

  // Group exercises by plan_id
  const exercisesByPlan = new Map<string, TrainingPlanExerciseRow[]>();
  for (const row of exerciseRows as Omit<TrainingPlanExerciseRow, "sets">[]) {
    const entry: TrainingPlanExerciseRow = {
      ...row,
      sets: setsByExercise.get(row.id) ?? [],
    };
    const list = exercisesByPlan.get(row.plan_id);
    if (list) {
      list.push(entry);
    } else {
      exercisesByPlan.set(row.plan_id, [entry]);
    }
  }

  return planRows.map(
    (row) =>
      ({
        ...row,
        exercises: exercisesByPlan.get(row.id as string) ?? [],
      }) as TrainingPlanRow,
  );
};

/**
 * Loads a single plan for a user (used after create/update).
 * Still uses 3 queries but scoped to one plan.
 */
const loadPlan = async (
  client: PoolClient,
  userId: string,
  planId: string,
): Promise<TrainingPlanRow | null> => {
  const { rows: planRows } = await client.query(
    `SELECT id, client_id, user_id, name, note, selected_days, created_at, updated_at
     FROM training_plans
     WHERE id = $1 AND user_id = $2`,
    [planId, userId],
  );
  if (planRows.length === 0) return null;
  const plan = planRows[0] as Omit<TrainingPlanRow, "exercises">;

  const { rows: exerciseRows } = await client.query(
    `SELECT
       tpe.id, tpe.client_id, tpe.plan_id, tpe.exercise_id, tpe.position,
       e.name AS exercise_name,
       e.muscles AS exercise_muscles,
       e.category AS exercise_category,
       e.description AS exercise_description,
       e.image_url AS exercise_image_url
     FROM training_plan_exercises tpe
     JOIN exercises e ON e.id = tpe.exercise_id
     WHERE tpe.plan_id = $1
     ORDER BY tpe.position, tpe.id`,
    [planId],
  );

  const exerciseIds = exerciseRows.map((r) => r.id as string);

  let setRows: TrainingPlanSetRow[] = [];
  if (exerciseIds.length > 0) {
    const result = await client.query(
      `SELECT id, client_id, plan_exercise_id, position, weight, reps, rir, tempo
       FROM training_plan_sets
       WHERE plan_exercise_id = ANY($1::uuid[])
       ORDER BY position, id`,
      [exerciseIds],
    );
    setRows = result.rows as TrainingPlanSetRow[];
  }

  const setsByExercise = new Map<string, TrainingPlanSetRow[]>();
  for (const row of setRows) {
    const list = setsByExercise.get(row.plan_exercise_id);
    if (list) {
      list.push(row);
    } else {
      setsByExercise.set(row.plan_exercise_id, [row]);
    }
  }

  const planExercises: TrainingPlanExerciseRow[] = (
    exerciseRows as Omit<TrainingPlanExerciseRow, "sets">[]
  ).map((row) => ({
    ...row,
    sets: setsByExercise.get(row.id) ?? [],
  }));

  return { ...plan, exercises: planExercises };
};

export const trainingPlansRepository = {
  list: async (userId: string): Promise<TrainingPlanRow[]> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      return await loadPlansForUser(client, userId);
    } finally {
      client.release();
    }
  },

  upsert: async (
    userId: string,
    body: TrainingPlanBodyInput,
  ): Promise<{ row: TrainingPlanRow; created: boolean }> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertExercisesVisible(client, userId, body);

      let planId: string;
      let created = true;
      if (body.clientId) {
        const { rows } = await client.query(
          `INSERT INTO training_plans (user_id, client_id, name, note, selected_days)
           VALUES ($1, $2::uuid, $3, $4, $5)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
           DO UPDATE SET
             name = EXCLUDED.name,
             note = EXCLUDED.note,
             selected_days = EXCLUDED.selected_days
           RETURNING id, (xmax = 0) AS inserted`,
          [userId, body.clientId, body.name, body.note, body.selectedDays],
        );
        planId = rows[0].id as string;
        created = rows[0].inserted as boolean;
      } else {
        const { rows } = await client.query(
          `INSERT INTO training_plans (user_id, name, note, selected_days)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [userId, body.name, body.note, body.selectedDays],
        );
        planId = rows[0].id as string;
      }

      await replaceChildren(client, planId, body);
      const row = await loadPlan(client, userId, planId);
      if (!row) throw new AppError(404, "not_found_or_not_yours");
      await client.query("COMMIT");
      return { row, created };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  update: async (
    userId: string,
    planId: string,
    body: TrainingPlanBodyInput,
  ): Promise<TrainingPlanRow | null> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertExercisesVisible(client, userId, body);
      const { rowCount } = await client.query(
        `UPDATE training_plans
         SET name = $1, note = $2, selected_days = $3
         WHERE id = $4 AND user_id = $5`,
        [body.name, body.note, body.selectedDays, planId, userId],
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      await replaceChildren(client, planId, body);
      const row = await loadPlan(client, userId, planId);
      await client.query("COMMIT");
      return row;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  deleteIfOwned: async (userId: string, planId: string): Promise<boolean> => {
    const pool = requirePool();
    const { rowCount } = await pool.query(
      "DELETE FROM training_plans WHERE id = $1 AND user_id = $2",
      [planId, userId],
    );
    return !!rowCount;
  },
};
