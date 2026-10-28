import { AppError } from "../../common/errors.js";
import { progressionOf } from "../../common/progression.js";
import { feedRepository } from "../feed/feed.repository.js";
import { profileRepository } from "../profile/profile.repository.js";
import { trainingHistoryRepository } from "../training-history/training-history.repository.js";
import type { TrainingPlanBodyInput } from "./training-plans.schemas.js";
import {
  trainingPlansRepository,
  type PlanCopySource,
  type TrainingPlanRow,
} from "./training-plans.repository.js";

/**
 * [withWeights] = false w cudzym planie: ciężary autora nie wychodzą poza
 * jego konto, kopiujący dobiera swoje.
 */
const formatPlan = (row: TrainingPlanRow, { withWeights = true } = {}) => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  note: row.note,
  selectedDays: row.selected_days,
  defaultRestSeconds: row.default_rest_seconds,
  colorKey: row.color_key,
  iconKey: row.icon_key,
  goal: row.goal,
  progressionStepKg:
    row.progression_step_kg === null ? null : Number(row.progression_step_kg),
  progression: progressionOf(row.progression),
  highlightPlanColor: row.highlight_plan_color,
  showRir: row.show_rir,
  showTempo: row.show_tempo,
  isPublic: row.is_public,
  copyCount: row.copy_count,
  copiedFrom:
    row.copied_from_user_id === null
      ? null
      : {
          planId: row.copied_from_plan_id,
          userId: row.copied_from_user_id,
          handle: row.copied_from_handle,
        },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  exercises: row.exercises.map((exercise) => ({
    id: exercise.id,
    clientId: exercise.client_id,
    exerciseId: exercise.exercise_id,
    position: exercise.position,
    restSeconds: exercise.rest_seconds,
    supersetGroup: exercise.superset_group,
    exercise: {
      id: exercise.exercise_id,
      name: exercise.exercise_name,
      muscles: exercise.exercise_muscles,
      category: exercise.exercise_category,
      description: exercise.exercise_description,
      imageUrl: exercise.exercise_image_url,
      trackingType: exercise.exercise_tracking_type,
      distanceUnit: exercise.exercise_distance_unit,
    },
    sets: exercise.sets.map((set) => ({
      id: set.id,
      clientId: set.client_id,
      position: set.position,
      weight: withWeights ? set.weight : null,
      reps: set.reps,
      rir: set.rir,
      tempo: set.tempo,
      durationSeconds: set.duration_seconds,
      distanceM: set.distance_m,
    })),
  })),
});

const toCopySource = (
  row: TrainingPlanRow,
  viewerId: string,
): PlanCopySource => {
  const own = row.user_id === viewerId;
  return {
    name: row.name,
    note: row.note,
    defaultRestSeconds: row.default_rest_seconds,
    colorKey: row.color_key,
    iconKey: row.icon_key,
    goal: row.goal,
    progressionStepKg: row.progression_step_kg,
    progression: progressionOf(row.progression),
    highlightPlanColor: row.highlight_plan_color,
    showRir: row.show_rir,
    showTempo: row.show_tempo,
    copiedFromPlanId: own ? null : row.id,
    copiedFromUserId: own ? null : row.user_id,
    exercises: row.exercises.map((exercise) => ({
      exerciseId: exercise.exercise_id,
      restSeconds: exercise.rest_seconds,
      supersetGroup: exercise.superset_group,
      sets: exercise.sets.map((set) => ({
        weight: own ? set.weight : null,
        reps: set.reps,
        rir: set.rir,
        tempo: set.tempo,
        durationSeconds: set.duration_seconds,
        distanceM: set.distance_m,
      })),
    })),
  };
};

const text = (value: string | number | null) =>
  value === null ? null : String(value).trim() || null;

export const trainingPlansService = {
  list: async (userId: string) => {
    const rows = await trainingPlansRepository.list(userId);
    return rows.map((row) => formatPlan(row));
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

  /** Plany widoczne na profilu osoby. */
  listPublic: async (viewerId: string, ownerId: string) => {
    const [exists, rows] = await Promise.all([
      profileRepository.userExists(ownerId),
      trainingPlansRepository.listPublic(viewerId, ownerId),
    ]);
    if (!exists) throw new AppError(404, "user_not_found");
    const own = viewerId === ownerId;
    return rows.map((row) => formatPlan(row, { withWeights: own }));
  },

  copy: async (viewerId: string, planId: string, clientId?: string) => {
    const source = await trainingPlansRepository.findCopyable(viewerId, planId);
    if (!source) throw new AppError(404, "plan_not_found");
    const { row, created, skippedExercises } =
      await trainingPlansRepository.insertCopy(
        viewerId,
        clientId,
        toCopySource(source, viewerId),
      );
    return { plan: { ...formatPlan(row), skippedExercises }, created };
  },

  /**
   * Plan z treningu z posta: ćwiczenia, przerwy, superserie i serie robocze
   * (bez rozgrzewek i bez ciężarów autora).
   */
  copyFromPost: async (
    viewerId: string,
    sessionId: string,
    clientId?: string,
  ) => {
    const post = await feedRepository.findVisiblePost(viewerId, sessionId);
    if (!post) throw new AppError(404, "post_not_found");
    const exercises = await trainingHistoryRepository.findExercises(sessionId);
    const sets = await trainingHistoryRepository.findSets(
      exercises.map((exercise) => exercise.id),
    );
    const own = post.user_id === viewerId;
    const source: PlanCopySource = {
      name: post.plan_name,
      note: null,
      defaultRestSeconds: 120,
      colorKey: null,
      iconKey: null,
      goal: null,
      progressionStepKg: null,
      progression: null,
      highlightPlanColor: true,
      showRir: true,
      showTempo: true,
      copiedFromPlanId: null,
      copiedFromUserId: own ? null : post.user_id,
      exercises: exercises.flatMap((exercise) => {
        if (!exercise.exercise_id) return [];
        return [
          {
            exerciseId: exercise.exercise_id,
            restSeconds: exercise.rest_seconds ?? null,
            supersetGroup: exercise.superset_group ?? null,
            sets: sets
              .filter(
                (set) =>
                  set.session_exercise_id === exercise.id &&
                  set.set_type !== "warmup",
              )
              .map((set) => ({
                weight: own
                  ? text(set.actual_weight_kg ?? set.planned_weight_kg)
                  : null,
                reps: text(set.actual_reps ?? set.planned_reps) ?? "",
                rir: text(set.actual_rir ?? set.planned_rir),
                tempo: text(set.actual_tempo ?? set.planned_tempo),
                durationSeconds:
                  set.actual_duration_seconds ?? set.planned_duration_seconds,
                distanceM: set.actual_distance_m ?? set.planned_distance_m,
              })),
          },
        ];
      }),
    };
    const { row, created, skippedExercises } =
      await trainingPlansRepository.insertCopy(viewerId, clientId, source);
    return { plan: { ...formatPlan(row), skippedExercises }, created };
  },
};
