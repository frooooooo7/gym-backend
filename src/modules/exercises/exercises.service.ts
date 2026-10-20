import { AppError } from "../../common/errors.js";
import {
  discardStoredImage,
  removeManagedImage,
  storeImage,
  toWebp,
} from "../../common/image-upload.js";
import {
  EXERCISE_IMAGE_MAX_DIMENSION,
  EXERCISE_IMAGES_PUBLIC_PREFIX,
} from "./exercises.image-upload.js";
import type { ListQueryInput, UpsertBodyInput } from "./exercises.schemas.js";
import {
  exercisesRepository,
  type ExerciseRow,
  type ExerciseRowSansFavourite,
  type ExerciseTrackingInput,
  type OwnedExerciseImageMeta,
} from "./exercises.repository.js";

const formatExercise = (row: ExerciseRow, userId?: string) => {
  const isMine = userId ? row.created_by === userId : false;
  return {
    id: row.id,
    name: row.name,
    muscles: row.muscles,
    category: row.category,
    description: row.description,
    imageUrl: row.image_url,
    trackingType: row.tracking_type ?? "weight_reps",
    distanceUnit: row.distance_unit ?? "km",
    createdAt: row.created_at,
    isFavourite: row.is_favourite,
    isMine,
    // clientId innych użytkowników nie jest nikomu potrzebny — nie ujawniamy go.
    clientId: isMine ? (row.client_id ?? null) : null,
  };
};

const trackingOf = (body: UpsertBodyInput): ExerciseTrackingInput => ({
  trackingType: body.trackingType,
  distanceUnit: body.distanceUnit,
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
    tracking?: ExerciseTrackingInput,
  ) => Promise<{ row: ExerciseRowSansFavourite; created: boolean }>;
  update: (
    name: string,
    muscles: string[],
    category: string,
    description: string,
    exerciseId: string,
    userId: string,
    tracking?: ExerciseTrackingInput,
  ) => Promise<ExerciseRowSansFavourite | null>;
  deleteIfOwned: (
    exerciseId: string,
    userId: string,
  ) => Promise<{ imageUrl: string | null } | null>;
  exerciseVisibleToUser: (
    exerciseId: string,
    userId: string,
  ) => Promise<boolean>;
  getOwnedExerciseImageMeta: (
    exerciseId: string,
    userId: string,
  ) => Promise<OwnedExerciseImageMeta>;
  replaceExerciseImageUrl: (
    exerciseId: string,
    userId: string,
    imageUrl: string,
  ) => Promise<{
    row: ExerciseRowSansFavourite;
    previousImageUrl: string | null;
  } | null>;
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
      trackingOf(body),
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
    const [row, fav] = await Promise.all([
      repo.update(
        body.name,
        [...body.muscles],
        body.category,
        body.description,
        exerciseId,
        userId,
        trackingOf(body),
      ),
      repo.hasFavourite(userId, exerciseId),
    ]);
    if (!row) {
      throw new AppError(404, "not_found_or_not_yours");
    }
    return formatExercise({ ...row, is_favourite: fav }, userId);
  },

  uploadExerciseImage: async (
    userId: string,
    exerciseId: string,
    upload: Buffer,
  ) => {
    // Ownership first: decoding is the expensive part and a foreign or
    // missing exercise must not cost CPU or disk.
    const meta = await repo.getOwnedExerciseImageMeta(exerciseId, userId);
    if (!meta.owned) {
      throw new AppError(404, "not_found_or_not_yours");
    }

    const image = await toWebp(upload, EXERCISE_IMAGE_MAX_DIMENSION);
    const stored = await storeImage(EXERCISE_IMAGES_PUBLIC_PREFIX, image);

    let result: Awaited<ReturnType<typeof repo.replaceExerciseImageUrl>>;
    let fav: boolean;
    try {
      [result, fav] = await Promise.all([
        repo.replaceExerciseImageUrl(exerciseId, userId, stored.publicPath),
        repo.hasFavourite(userId, exerciseId),
      ]);
    } catch (e) {
      await discardStoredImage(stored);
      throw e;
    }
    if (!result) {
      await discardStoredImage(stored);
      throw new AppError(404, "not_found_or_not_yours");
    }

    if (result.previousImageUrl !== stored.publicPath) {
      await removeManagedImage(result.previousImageUrl, EXERCISE_IMAGES_PUBLIC_PREFIX);
    }

    return formatExercise({ ...result.row, is_favourite: fav }, userId);
  },

  deleteIfOwned: async (userId: string, exerciseId: string) => {
    const deleted = await repo.deleteIfOwned(exerciseId, userId);
    if (!deleted) {
      throw new AppError(404, "not_found_or_not_yours");
    }
    await removeManagedImage(deleted.imageUrl, EXERCISE_IMAGES_PUBLIC_PREFIX);
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
