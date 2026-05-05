import { AppError } from "../../common/errors.js";
import type { ListQueryInput, UpsertBodyInput } from "./exercises.schemas.js";
import {
  exercisesRepository,
  type ExerciseRow,
  type ExerciseRowSansFavourite,
} from "./exercises.repository.js";

const formatExercise = (row: ExerciseRow, userId?: string) => ({
  id: row.id,
  name: row.name,
  muscles: row.muscles,
  category: row.category,
  createdAt: row.created_at,
  isFavourite: row.is_favourite,
  isMine: userId ? row.created_by === userId : false,
});

export type ExercisesRepositoryDeps = {
  list: (userId: string, query: ListQueryInput) => Promise<ExerciseRow[]>;
  insert: (
    name: string,
    muscles: string[],
    category: string,
    userId: string,
  ) => Promise<ExerciseRowSansFavourite>;
  update: (
    name: string,
    muscles: string[],
    category: string,
    exerciseId: string,
    userId: string,
  ) => Promise<ExerciseRowSansFavourite | null>;
  deleteIfOwned: (exerciseId: string, userId: string) => Promise<boolean>;
  exerciseExists: (exerciseId: string) => Promise<boolean>;
  insertFavouriteIfAbsent: (
    userId: string,
    exerciseId: string,
  ) => Promise<number>;
  deleteFavourite: (userId: string, exerciseId: string) => Promise<void>;
  hasFavourite: (userId: string, exerciseId: string) => Promise<boolean>;
};

export const createExercisesService = (repo: ExercisesRepositoryDeps) => ({
  list: async (userId: string, query: ListQueryInput) => {
    const rows = await repo.list(userId, query);
    return rows.map((r) => formatExercise(r, userId));
  },

  create: async (userId: string, body: UpsertBodyInput) => {
    const row = await repo.insert(
      body.name,
      [...body.muscles],
      body.category,
      userId,
    );
    return formatExercise({ ...row, is_favourite: false }, userId);
  },

  update: async (
    userId: string,
    exerciseId: string,
    body: UpsertBodyInput,
  ) => {
    const row = await repo.update(
      body.name,
      [...body.muscles],
      body.category,
      exerciseId,
      userId,
    );
    if (!row) {
      throw new AppError(404, "not_found_or_not_yours");
    }
    const fav = await repo.hasFavourite(userId, exerciseId);
    return formatExercise({ ...row, is_favourite: fav }, userId);
  },

  deleteIfOwned: async (userId: string, exerciseId: string) => {
    const deleted = await repo.deleteIfOwned(exerciseId, userId);
    if (!deleted) {
      throw new AppError(404, "not_found_or_not_yours");
    }
  },

  toggleFavourite: async (userId: string, exerciseId: string) => {
    const exists = await repo.exerciseExists(exerciseId);
    if (!exists) {
      throw new AppError(404, "exercise_not_found");
    }

    const inserted = await repo.insertFavouriteIfAbsent(userId, exerciseId);
    if (inserted > 0) {
      return { exerciseId, isFavourite: true as const };
    }

    await repo.deleteFavourite(userId, exerciseId);
    return { exerciseId, isFavourite: false as const };
  },
});

export const exercisesService = createExercisesService(exercisesRepository);
