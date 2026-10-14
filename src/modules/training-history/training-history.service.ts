import { AppError } from "../../common/errors.js";
import { encodeCursor } from "./training-history.schemas.js";
import {
  trainingHistoryRepository,
  type TrainingHistorySetRow,
} from "./training-history.repository.js";

/** Numeric text (comma or dot decimals) → number; unparsable → null. */
const toNumber = (value: string | number | null): number | null => {
  if (value === null) return null;
  const parsed =
    typeof value === "number" ? value : Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

export const groupSetsByExerciseId = (
  sets: TrainingHistorySetRow[],
): Map<string, TrainingHistorySetRow[]> => {
  const setsByExerciseId = new Map<string, TrainingHistorySetRow[]>();
  for (const set of sets) {
    const existing = setsByExerciseId.get(set.session_exercise_id);
    if (existing) {
      existing.push(set);
    } else {
      setsByExerciseId.set(set.session_exercise_id, [set]);
    }
  }
  return setsByExerciseId;
};

export const mapSet = (set: TrainingHistorySetRow) => ({
  setIndex: set.set_index,
  setType: set.set_type,
  planned: {
    weightKg: toNumber(set.planned_weight_kg),
    reps: toNumber(set.planned_reps),
    rir: toNumber(set.planned_rir),
    tempo: set.planned_tempo,
    durationSeconds: set.planned_duration_seconds ?? null,
    distanceM: set.planned_distance_m ?? null,
  },
  actual: {
    weightKg: toNumber(set.actual_weight_kg),
    reps: toNumber(set.actual_reps),
    rir: toNumber(set.actual_rir),
    tempo: set.actual_tempo,
    durationSeconds: set.actual_duration_seconds ?? null,
    distanceM: set.actual_distance_m ?? null,
  },
  completed: set.completed,
  completedAt: set.completed_at?.toISOString() ?? null,
});

export interface TrainingHistoryListInput {
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

export const trainingHistoryService = {
  list: async (input: TrainingHistoryListInput) => {
    const rows = await trainingHistoryRepository.list(input);
    const hasMore = rows.length > input.limit;
    const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;

    const items = visibleRows.map((row) => ({
      id: row.id,
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
      durationSec: row.duration_sec,
      status: row.status,
      plan: {
        id: row.plan_id,
        name: row.plan_name,
        colorKey: row.plan_color_key ?? null,
        iconKey: row.plan_icon_key ?? null,
      },
      exercisesCount: row.exercises_count,
      completedSetsCount: row.completed_sets_count,
      totalVolumeKg: toNumber(row.total_volume_kg) ?? 0,
      hasNote: !!row.note?.trim(),
      progressHighlight:
        row.progress_type && row.progress_label
          ? {
              type: row.progress_type,
              label: row.progress_label,
            }
          : null,
      updatedAt: row.updated_at.toISOString(),
    }));

    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor(new Date(last.startedAt), last.id)
          : null,
      hasMore,
    };
  },

  getById: async (userId: string, sessionId: string) => {
    const [session, exercises] = await Promise.all([
      trainingHistoryRepository.findOneForUser(userId, sessionId),
      trainingHistoryRepository.findExercises(sessionId),
    ]);
    if (!session) {
      throw new AppError(
        404,
        "not_found_or_not_yours",
        "training history entry was not found for this user",
      );
    }
    const sets = await trainingHistoryRepository.findSets(exercises.map((e) => e.id));
    const setsByExerciseId = groupSetsByExerciseId(sets);

    return {
      id: session.id,
      startedAt: session.started_at.toISOString(),
      endedAt: session.ended_at?.toISOString() ?? null,
      durationSec: session.duration_sec,
      status: session.status,
      plan: {
        id: session.plan_id,
        name: session.plan_name,
        colorKey: session.plan_color_key ?? null,
        iconKey: session.plan_icon_key ?? null,
      },
      note: session.note,
      sharedToProfile: session.shared_to_profile,
      updatedAt: session.updated_at.toISOString(),
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exercise_id,
        exerciseName: exercise.exercise_name,
        muscles: exercise.exercise_muscles ?? [],
        imageUrl: exercise.exercise_image_url,
        note: exercise.note,
        restSeconds: exercise.rest_seconds ?? null,
        supersetGroup: exercise.superset_group ?? null,
        trackingType: exercise.exercise_tracking_type ?? "weight_reps",
        distanceUnit: exercise.exercise_distance_unit ?? "km",
        sets: (setsByExerciseId.get(exercise.id) ?? []).map(mapSet),
      })),
    };
  },
};

