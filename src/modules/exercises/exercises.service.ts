import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../common/errors.js";
import type { ListQueryInput, UpsertBodyInput } from "./exercises.schemas.js";
import {
  exercisesRepository,
  type ExerciseRow,
  type ExerciseRowSansFavourite,
  type OwnedExerciseImageMeta,
} from "./exercises.repository.js";

const diskPathFromPublicUrl = (publicUrl: string): string =>
  path.join(process.cwd(), ...publicUrl.replace(/^\/+/, "").split("/"));

const safeUnlink = async (absPath: string): Promise<void> => {
  try {
    await fs.unlink(absPath);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw e;
  }
};

const formatExercise = (row: ExerciseRow, userId?: string) => ({
  id: row.id,
  name: row.name,
  muscles: row.muscles,
  category: row.category,
  description: row.description,
  imageUrl: row.image_url,
  createdAt: row.created_at,
  isFavourite: row.is_favourite,
  isMine: userId ? row.created_by === userId : false,
});

export type ExercisesRepositoryDeps = {
  list: (userId: string, query: ListQueryInput) => Promise<ExerciseRow[]>;
  insertUserExercise: (
    name: string,
    muscles: string[],
    category: string,
    description: string,
    userId: string,
    clientId: string | undefined,
  ) => Promise<{ row: ExerciseRowSansFavourite; created: boolean }>;
  update: (
    name: string,
    muscles: string[],
    category: string,
    description: string,
    exerciseId: string,
    userId: string,
  ) => Promise<ExerciseRowSansFavourite | null>;
  deleteIfOwned: (exerciseId: string, userId: string) => Promise<boolean>;
  exerciseVisibleToUser: (
    exerciseId: string,
    userId: string,
  ) => Promise<boolean>;
  getOwnedExerciseImageMeta: (
    exerciseId: string,
    userId: string,
  ) => Promise<OwnedExerciseImageMeta>;
  updateExerciseImageUrl: (
    exerciseId: string,
    userId: string,
    imageUrl: string,
  ) => Promise<ExerciseRowSansFavourite | null>;
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
    const { row, created } = await repo.insertUserExercise(
      body.name,
      [...body.muscles],
      body.category,
      body.description,
      userId,
      body.clientId,
    );
    return {
      exercise: formatExercise({ ...row, is_favourite: false }, userId),
      created,
    };
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
      body.description,
      exerciseId,
      userId,
    );
    if (!row) {
      throw new AppError(404, "not_found_or_not_yours");
    }
    const fav = await repo.hasFavourite(userId, exerciseId);
    return formatExercise({ ...row, is_favourite: fav }, userId);
  },

  uploadExerciseImage: async (
    userId: string,
    exerciseId: string,
    publicPath: string,
    savedDiskPath: string,
  ) => {
    const meta = await repo.getOwnedExerciseImageMeta(exerciseId, userId);
    if (!meta.owned) {
      await safeUnlink(savedDiskPath);
      throw new AppError(404, "not_found_or_not_yours");
    }

    const row = await repo.updateExerciseImageUrl(
      exerciseId,
      userId,
      publicPath,
    );
    if (!row) {
      await safeUnlink(savedDiskPath);
      throw new AppError(404, "not_found_or_not_yours");
    }

    if (meta.imageUrl) {
      await safeUnlink(diskPathFromPublicUrl(meta.imageUrl));
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
    const visible = await repo.exerciseVisibleToUser(exerciseId, userId);
    if (!visible) {
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
