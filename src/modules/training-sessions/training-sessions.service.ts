import { AppError } from "../../common/errors.js";
import type { TrainingSessionBodyInput } from "./training-sessions.schemas.js";
import {
  trainingSessionsRepository,
  type TrainingSessionRow,
} from "./training-sessions.repository.js";

const formatSession = (row: TrainingSessionRow) => ({
  id: row.id,
  clientId: row.client_id,
  planId: row.plan_id,
  planClientId: row.plan_client_id,
  planName: row.plan_name,
  status: row.status,
  note: row.note,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  exercises: row.exercises.map((exercise) => ({
    id: exercise.id,
    clientId: exercise.client_id,
    exerciseId: exercise.exercise_id,
    exerciseClientId: exercise.exercise_client_id,
    exerciseName: exercise.exercise_name,
    exerciseMuscles: exercise.exercise_muscles,
    exerciseCategory: exercise.exercise_category,
    exerciseImageUrl: exercise.exercise_image_url,
    position: exercise.position,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      clientId: set.client_id,
      position: set.position,
      plannedWeight: set.planned_weight,
      plannedReps: set.planned_reps,
      plannedRir: set.planned_rir,
      plannedTempo: set.planned_tempo,
      actualWeight: set.actual_weight,
      actualReps: set.actual_reps,
      actualRir: set.actual_rir,
      actualTempo: set.actual_tempo,
      completed: set.completed,
      completedAt: set.completed_at,
    })),
  })),
});

export const trainingSessionsService = {
  upsert: async (userId: string, body: TrainingSessionBodyInput) => {
    const { row, created } = await trainingSessionsRepository.upsert(
      userId,
      body,
    );
    return { session: formatSession(row), created };
  },

  update: async (
    userId: string,
    sessionId: string,
    body: TrainingSessionBodyInput,
  ) => {
    const row = await trainingSessionsRepository.update(
      userId,
      sessionId,
      body,
    );
    if (!row) throw new AppError(404, "not_found_or_not_yours");
    return formatSession(row);
  },

  active: async (userId: string) => {
    const row = await trainingSessionsRepository.active(userId);
    return row ? formatSession(row) : null;
  },

  history: async (userId: string) => {
    const rows = await trainingSessionsRepository.history(userId);
    return rows.map(formatSession);
  },
};
