import { AppError } from "../../common/errors.js";
import {
  discardStoredImage,
  removeManagedImage,
  storeImage,
  toWebp,
} from "../../common/image-upload.js";
import {
  POST_PHOTO_MAX_DIMENSION,
  POST_PHOTOS_PUBLIC_PREFIX,
} from "./training-sessions.post-photo.js";
import {
  encodeHistoryCursor,
  type SharedToProfileBodyInput,
  type TrainingSessionBodyInput,
} from "./training-sessions.schemas.js";
import {
  trainingSessionsRepository,
  type TrainingSessionHistoryFilters,
  type TrainingSessionRow,
} from "./training-sessions.repository.js";

const formatSession = (row: TrainingSessionRow) => ({
  id: row.id,
  clientId: row.client_id,
  planId: row.plan_id,
  planClientId: row.plan_client_id,
  planName: row.plan_name,
  planColorKey: row.plan_color_key,
  planIconKey: row.plan_icon_key,
  status: row.status,
  note: row.note,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  sharedToProfile: row.shared_to_profile,
  postTitle: row.post_title,
  postPhotoUrl: row.post_photo_url,
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
    note: exercise.note,
    restSeconds: exercise.rest_seconds,
    supersetGroup: exercise.superset_group,
    exerciseTrackingType: exercise.exercise_tracking_type,
    exerciseDistanceUnit: exercise.exercise_distance_unit,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      clientId: set.client_id,
      position: set.position,
      setType: set.set_type,
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
      plannedDurationSeconds: set.planned_duration_seconds,
      plannedDistanceM: set.planned_distance_m,
      actualDurationSeconds: set.actual_duration_seconds,
      actualDistanceM: set.actual_distance_m,
    })),
  })),
});

const removePostPhoto = (url: string | null) =>
  removeManagedImage(url, POST_PHOTOS_PUBLIC_PREFIX);

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

  history: async (userId: string, filters: TrainingSessionHistoryFilters) => {
    const rows = await trainingSessionsRepository.history(userId, filters);
    const hasMore = rows.length > filters.limit;
    const visibleRows = hasMore ? rows.slice(0, filters.limit) : rows;
    const items = visibleRows.map(formatSession);
    const last = items.at(-1);
    // Deletions are only reported with an incremental sync, all at once on the
    // first page (no cursor) — later pages carry `deleted: []`.
    const tombstones =
      filters.updatedSince && !filters.cursor
        ? await trainingSessionsRepository.deletedSince(
            userId,
            filters.updatedSince,
          )
        : [];
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeHistoryCursor(new Date(last.startedAt), last.id)
          : null,
      hasMore,
      deleted: tombstones.map((row) => ({
        id: row.session_id,
        clientId: row.client_id,
        deletedAt: row.deleted_at,
      })),
    };
  },

  remove: async (userId: string, sessionId: string) => {
    const result = await trainingSessionsRepository.remove(userId, sessionId);
    if (result.status === "not_found")
      throw new AppError(404, "not_found_or_not_yours");
    await removePostPhoto(result.postPhotoUrl);
  },

  removeByClientId: async (userId: string, clientId: string) => {
    const photoUrl = await trainingSessionsRepository.removeByClientId(
      userId,
      clientId,
    );
    await removePostPhoto(photoUrl);
  },

  setSharedToProfile: async (
    userId: string,
    sessionId: string,
    input: SharedToProfileBodyInput,
  ) => {
    const row = await trainingSessionsRepository.setSharedToProfile(
      userId,
      sessionId,
      input,
    );
    if (!row) throw new AppError(404, "not_found_or_not_yours");
    return formatSession(row);
  },

  /** Re-encodes the upload as WebP and makes it the session's post photo. */
  uploadPostPhoto: async (userId: string, sessionId: string, upload: Buffer) => {
    const image = await toWebp(upload, POST_PHOTO_MAX_DIMENSION);
    const stored = await storeImage(POST_PHOTOS_PUBLIC_PREFIX, image);
    let result: Awaited<
      ReturnType<typeof trainingSessionsRepository.setPostPhoto>
    >;
    try {
      result = await trainingSessionsRepository.setPostPhoto(
        userId,
        sessionId,
        stored.publicPath,
      );
    } catch (e) {
      await discardStoredImage(stored);
      throw e;
    }
    if (!result) {
      await discardStoredImage(stored);
      throw new AppError(404, "not_found_or_not_yours");
    }
    if (result.previousUrl !== stored.publicPath) {
      await removePostPhoto(result.previousUrl);
    }
    return formatSession(result.row);
  },

  deletePostPhoto: async (userId: string, sessionId: string) => {
    const result = await trainingSessionsRepository.setPostPhoto(
      userId,
      sessionId,
      null,
    );
    if (!result) throw new AppError(404, "not_found_or_not_yours");
    await removePostPhoto(result.previousUrl);
    return formatSession(result.row);
  },
};
