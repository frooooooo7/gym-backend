import { AppError } from "../../common/errors.js";
import { isForeignKeyViolation } from "../../common/pg-errors.js";
import { profileRepository } from "../profile/profile.repository.js";
import { formatFollowingUser } from "../profile/profile.service.js";
import { trainingHistoryRepository } from "../training-history/training-history.repository.js";
import {
  groupSetsByExerciseId,
  mapSet,
} from "../training-history/training-history.service.js";
import {
  feedRepository,
  type CommentRow,
  type ExerciseBestsRow,
  type PostRow,
  type PostSocialRow,
  type PostStatsRow,
  type RecentKudoRow,
  type TopExerciseRow,
  type UserMiniRow,
} from "./feed.repository.js";
import { commentCursor, feedCursor, type KeysetCursor } from "./feed.schemas.js";

const RECENT_KUDOS_LIMIT = 3;
const TOP_EXERCISES_LIMIT = 3;

const formatUserMini = (row: UserMiniRow) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  handle: row.handle,
  avatarUrl: row.avatar_url,
});

const groupBySession = <T extends { session_id: string }>(
  rows: T[],
): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.session_id);
    if (existing) existing.push(row);
    else grouped.set(row.session_id, [row]);
  }
  return grouped;
};

const formatTopExercise = (row: TopExerciseRow) => ({
  name: row.exercise_name,
  completedSets: row.completed_sets,
  bestSet:
    row.best_weight_kg === null
      ? null
      : { weightKg: row.best_weight_kg, reps: row.best_reps },
});

/**
 * Below this difference (kg) a higher estimated 1RM is a tie: Epley yields
 * fractions and a 0.01 kg "improvement" is rounding noise. Same as the app.
 */
const ONE_REP_MAX_EPSILON = 0.05;

type PersonalRecordKind = "weight" | "oneRepMax" | "reps";

/**
 * New personal records of one exercise in a post — the same rules as the
 * app's stats screen: the first time an exercise is logged sets the baseline
 * (no record); afterwards a heavier set, a higher estimated 1RM or, without
 * weight, more reps than in any earlier completed session is a record.
 * `weightKg`/`reps` describe the set behind the primary (first) kind and
 * `improvement` is the gain over the previous best of that kind.
 */
export const personalRecordOf = (row: ExerciseBestsRow) => {
  if (!row.has_previous) return null;
  const kinds: PersonalRecordKind[] = [];
  let improvement: number | null = null;

  const weight = row.best_weight_kg;
  const prevWeight = row.prev_weight_kg;
  if (weight !== null && weight > (prevWeight ?? 0)) {
    kinds.push("weight");
    improvement = prevWeight === null ? null : weight - prevWeight;
  }
  const oneRm = row.best_one_rep_max_kg;
  const prevOneRm = row.prev_one_rep_max_kg;
  if (oneRm !== null && oneRm > (prevOneRm ?? 0) + ONE_REP_MAX_EPSILON) {
    kinds.push("oneRepMax");
    if (improvement === null && prevOneRm !== null) {
      improvement = oneRm - prevOneRm;
    }
  }
  const reps = row.best_bodyweight_reps;
  const prevReps = row.prev_bodyweight_reps;
  if (reps !== null && reps > (prevReps ?? 0)) {
    kinds.push("reps");
    if (kinds.length === 1 && prevReps !== null) improvement = reps - prevReps;
  }
  if (kinds.length === 0) return null;

  const primary = kinds[0];
  return {
    exerciseName: row.exercise_name,
    kinds,
    weightKg:
      primary === "weight"
        ? weight
        : primary === "oneRepMax"
          ? row.best_one_rep_max_weight_kg
          : null,
    reps:
      primary === "weight"
        ? row.best_weight_reps
        : primary === "oneRepMax"
          ? row.best_one_rep_max_reps
          : reps,
    oneRepMaxKg: oneRm === null ? null : Math.round(oneRm * 100) / 100,
    improvement: improvement === null ? null : Math.round(improvement * 100) / 100,
  };
};

const formatPost = (
  viewerId: string,
  row: PostRow,
  stats: PostStatsRow | undefined,
  social: PostSocialRow | undefined,
  topExercises: TopExerciseRow[],
  exerciseBests: ExerciseBestsRow[],
  recentKudos: RecentKudoRow[],
) => ({
  id: row.id,
  author: formatUserMini({
    id: row.user_id,
    first_name: row.author_first_name,
    last_name: row.author_last_name,
    handle: row.author_handle,
    avatar_url: row.author_avatar_url,
  }),
  title: row.plan_name,
  note: row.note,
  startedAt: row.started_at.toISOString(),
  finishedAt: row.finished_at?.toISOString() ?? null,
  durationSec: row.duration_sec,
  exercisesCount: stats?.exercises_count ?? 0,
  completedSetsCount: stats?.completed_sets_count ?? 0,
  totalVolumeKg: Number(stats?.total_volume_kg ?? 0),
  muscles: stats?.muscles ?? [],
  topExercises: topExercises.map(formatTopExercise),
  personalRecords: exerciseBests
    .map(personalRecordOf)
    .filter((record) => record !== null),
  kudosCount: social?.kudos_count ?? 0,
  commentCount: social?.comment_count ?? 0,
  hasKudoed: social?.has_kudoed === true,
  isOwn: row.user_id === viewerId,
  recentKudos: recentKudos.map(formatUserMini),
});

/** Loads aggregates for a whole page of posts in 5 batched queries. */
const buildPosts = async (viewerId: string, rows: PostRow[]) => {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [stats, social, topExercises, exerciseBests, recentKudos] =
    await Promise.all([
      feedRepository.findPostStats(ids),
      feedRepository.findSocialStats(ids, viewerId),
      feedRepository.findTopExercises(ids, TOP_EXERCISES_LIMIT),
      feedRepository.findExerciseBests(ids),
      feedRepository.findRecentKudos(ids, RECENT_KUDOS_LIMIT),
    ]);
  const statsById = new Map(stats.map((s) => [s.session_id, s]));
  const socialById = new Map(social.map((s) => [s.session_id, s]));
  const topById = groupBySession(topExercises);
  const bestsById = groupBySession(exerciseBests);
  const kudosById = groupBySession(recentKudos);
  return rows.map((row) =>
    formatPost(
      viewerId,
      row,
      statsById.get(row.id),
      socialById.get(row.id),
      topById.get(row.id) ?? [],
      bestsById.get(row.id) ?? [],
      kudosById.get(row.id) ?? [],
    ),
  );
};

const formatComment = (
  row: CommentRow,
  viewerId: string,
  postOwnerId: string,
) => {
  const isOwn = row.user_id === viewerId;
  return {
    id: row.id,
    author: formatUserMini({
      id: row.user_id,
      first_name: row.first_name,
      last_name: row.last_name,
      handle: row.handle,
      avatar_url: row.avatar_url,
    }),
    body: row.body,
    createdAt: row.created_at.toISOString(),
    isOwn,
    canDelete: isOwn || postOwnerId === viewerId,
  };
};

const requireVisiblePost = async (
  viewerId: string,
  sessionId: string,
): Promise<PostRow> => {
  const post = await feedRepository.findVisiblePost(viewerId, sessionId);
  if (!post) {
    throw new AppError(404, "post_not_found");
  }
  return post;
};

export const feedService = {
  getFeed: async (viewerId: string, limit: number, cursor?: KeysetCursor) => {
    const rows = await feedRepository.listFeed(viewerId, limit + 1, cursor);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = await buildPosts(viewerId, pageRows);
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last ? feedCursor.encode(last.cursor_started_at, last.id) : null,
      hasMore,
    };
  },

  getUserPosts: async (
    viewerId: string,
    authorId: string,
    limit: number,
    cursor?: KeysetCursor,
  ) => {
    const [exists, rows] = await Promise.all([
      profileRepository.userExists(authorId),
      feedRepository.listUserPosts(authorId, limit + 1, cursor),
    ]);
    if (!exists) {
      throw new AppError(404, "user_not_found");
    }
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = await buildPosts(viewerId, pageRows);
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last ? feedCursor.encode(last.cursor_started_at, last.id) : null,
      hasMore,
    };
  },

  getPost: async (viewerId: string, sessionId: string) => {
    const post = await requireVisiblePost(viewerId, sessionId);
    const [[feedPost], exercises] = await Promise.all([
      buildPosts(viewerId, [post]),
      trainingHistoryRepository.findExercises(sessionId),
    ]);
    const sets = await trainingHistoryRepository.findSets(
      exercises.map((exercise) => exercise.id),
    );
    const setsByExerciseId = groupSetsByExerciseId(sets);
    return {
      ...feedPost,
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exercise_id,
        exerciseName: exercise.exercise_name,
        exerciseMuscles: exercise.exercise_muscles ?? [],
        exerciseCategory: exercise.exercise_category,
        imageUrl: exercise.exercise_image_url,
        sets: (setsByExerciseId.get(exercise.id) ?? []).map(mapSet),
      })),
    };
  },

  giveKudo: async (viewerId: string, sessionId: string) => {
    const post = await requireVisiblePost(viewerId, sessionId);
    if (post.user_id === viewerId) {
      throw new AppError(400, "cannot_kudo_own_post");
    }
    try {
      await feedRepository.insertKudo(sessionId, viewerId);
    } catch (e: unknown) {
      // Session (or viewer) removed between the visibility check and the insert.
      if (isForeignKeyViolation(e)) {
        throw new AppError(404, "post_not_found");
      }
      throw e;
    }
    const kudosCount = await feedRepository.countKudos(sessionId);
    return { hasKudoed: true as const, kudosCount };
  },

  removeKudo: async (viewerId: string, sessionId: string) => {
    await requireVisiblePost(viewerId, sessionId);
    await feedRepository.deleteKudo(sessionId, viewerId);
    const kudosCount = await feedRepository.countKudos(sessionId);
    return { hasKudoed: false as const, kudosCount };
  },

  listKudos: async (
    viewerId: string,
    sessionId: string,
    limit: number,
    offset: number,
  ) => {
    await requireVisiblePost(viewerId, sessionId);
    const rows = await feedRepository.listKudos(
      sessionId,
      viewerId,
      limit,
      offset,
    );
    return rows.map(formatFollowingUser);
  },

  listComments: async (
    viewerId: string,
    sessionId: string,
    limit: number,
    cursor?: KeysetCursor,
  ) => {
    const post = await requireVisiblePost(viewerId, sessionId);
    const rows = await feedRepository.listComments(sessionId, limit + 1, cursor);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => formatComment(row, viewerId, post.user_id)),
      nextCursor:
        hasMore && last
          ? commentCursor.encode(last.cursor_created_at, last.id)
          : null,
      hasMore,
    };
  },

  addComment: async (viewerId: string, sessionId: string, body: string) => {
    const post = await requireVisiblePost(viewerId, sessionId);
    let row: CommentRow | undefined;
    try {
      row = await feedRepository.insertComment(sessionId, viewerId, body);
    } catch (e: unknown) {
      if (isForeignKeyViolation(e)) {
        throw new AppError(404, "post_not_found");
      }
      throw e;
    }
    if (!row) {
      throw new AppError(404, "post_not_found");
    }
    return formatComment(row, viewerId, post.user_id);
  },

  deleteComment: async (
    viewerId: string,
    sessionId: string,
    commentId: string,
  ) => {
    const post = await requireVisiblePost(viewerId, sessionId);
    const comment = await feedRepository.findCommentOnPost(commentId, sessionId);
    if (!comment) {
      throw new AppError(404, "comment_not_found");
    }
    if (comment.user_id !== viewerId && post.user_id !== viewerId) {
      throw new AppError(403, "forbidden");
    }
    await feedRepository.deleteComment(commentId);
  },

  getSuggestedUsers: async (viewerId: string, limit: number) => {
    const rows = await feedRepository.listSuggestedUsers(viewerId, limit);
    return rows.map(formatFollowingUser);
  },
};
