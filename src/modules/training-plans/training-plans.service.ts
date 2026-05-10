import { AppError } from "../../common/errors.js";
import type { TrainingPlanBodyInput } from "./training-plans.schemas.js";
import {
  trainingPlansRepository,
  type TrainingPlanRow,
} from "./training-plans.repository.js";

const formatPlan = (row: TrainingPlanRow) => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  note: row.note,
  selectedDays: row.selected_days,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  exercises: row.exercises.map((exercise) => ({
    id: exercise.id,
    clientId: exercise.client_id,
    exerciseId: exercise.exercise_id,
    position: exercise.position,
    exercise: {
      id: exercise.exercise_id,
      name: exercise.exercise_name,
      muscles: exercise.exercise_muscles,
      category: exercise.exercise_category,
      description: exercise.exercise_description,
      imageUrl: exercise.exercise_image_url,
    },
    sets: exercise.sets.map((set) => ({
      id: set.id,
      clientId: set.client_id,
      position: set.position,
      weight: set.weight,
      reps: set.reps,
      rir: set.rir,
      tempo: set.tempo,
    })),
  })),
});

export const trainingPlansService = {
  list: async (userId: string) => {
    const rows = await trainingPlansRepository.list(userId);
    return rows.map(formatPlan);
  },

  create: async (userId: string, body: TrainingPlanBodyInput) => {
    const { row, created } = await trainingPlansRepository.upsert(userId, body);
    return { plan: formatPlan(row), created };
  },

  update: async (
    userId: string,
    planId: string,
    body: TrainingPlanBodyInput,
  ) => {
    const row = await trainingPlansRepository.update(userId, planId, body);
    if (!row) throw new AppError(404, "not_found_or_not_yours");
    return formatPlan(row);
  },

  deleteIfOwned: async (userId: string, planId: string) => {
    const deleted = await trainingPlansRepository.deleteIfOwned(userId, planId);
    if (!deleted) throw new AppError(404, "not_found_or_not_yours");
  },
};
