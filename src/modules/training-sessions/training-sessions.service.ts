import { AppError } from "../../common/errors.js";
import { encodeCursor } from "./training-sessions.schemas.js";
import {
  trainingSessionsRepository,
  type TrainingSessionSetRow,
} from "./training-sessions.repository.js";

const toNumber = (value: string | null): number | null =>
  value === null ? null : Number(value);

const mapSet = (set: TrainingSessionSetRow) => ({
  setIndex: set.set_index,
  planned: {
    weightKg: toNumber(set.planned_weight_kg),
    reps: set.planned_reps,
    rir: set.planned_rir,
    tempo: set.planned_tempo,
  },
  actual: {
    weightKg: toNumber(set.actual_weight_kg),
    reps: set.actual_reps,
    rir: set.actual_rir,
    tempo: set.actual_tempo,
  },
  completed: set.completed,
});

export interface TrainingSessionsListInput {
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

export const trainingSessionsService = {
  list: async (input: TrainingSessionsListInput) => {
    const rows = await trainingSessionsRepository.list(input);
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
      },
      exercisesCount: row.exercises_count,
      completedSetsCount: row.completed_sets_count,
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
    const session = await trainingSessionsRepository.findOneForUser(
      userId,
      sessionId,
    );
    if (!session) {
      throw new AppError(
        404,
        "not_found_or_not_yours",
        "Training session was not found for this user",
      );
    }

    const exercises = await trainingSessionsRepository.findExercises(sessionId);
    const sets = await trainingSessionsRepository.findSets(exercises.map((e) => e.id));
    const setsByExerciseId = new Map<string, TrainingSessionSetRow[]>();
    for (const set of sets) {
      const existing = setsByExerciseId.get(set.session_exercise_id);
      if (existing) {
        existing.push(set);
      } else {
        setsByExerciseId.set(set.session_exercise_id, [set]);
      }
    }

    return {
      id: session.id,
      startedAt: session.started_at.toISOString(),
      endedAt: session.ended_at?.toISOString() ?? null,
      durationSec: session.duration_sec,
      status: session.status,
      plan: {
        id: session.plan_id,
        name: session.plan_name,
      },
      note: session.note,
      updatedAt: session.updated_at.toISOString(),
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exercise_id,
        exerciseName: exercise.exercise_name,
        sets: (setsByExerciseId.get(exercise.id) ?? []).map(mapSet),
      })),
    };
  },
};

