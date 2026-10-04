import { requirePool } from "../../db/require-pool.js";
import {
  countsTowardStatsSql,
  cursorTimestampSql,
  parsedRepsSql,
  parsedWeightSql,
  sessionDurationSecSql,
  setVolumeSql,
} from "../../db/sql-fragments.js";
import type { FollowingUserRow } from "../profile/profile.repository.js";
import type { KeysetCursor } from "./feed.schemas.js";

export interface UserMiniRow {
  id: string;
  first_name: string;
  last_name: string;
  handle: string;
  avatar_url: string | null;
}

export interface PostRow {
  id: string;
  user_id: string;
  plan_name: string;
  note: string | null;
  started_at: Date;
  finished_at: Date | null;
  duration_sec: number;
  /** started_at with µs precision, for keyset cursors. */
  cursor_started_at: string;
  author_first_name: string;
  author_last_name: string;
  author_handle: string;
  author_avatar_url: string | null;
}

export interface PostStatsRow {
  session_id: string;
  exercises_count: number;
  completed_sets_count: number;
  total_volume_kg: number;
  muscles: string[];
}

export interface PostSocialRow {
  session_id: string;
  kudos_count: number;
  comment_count: number;
  has_kudoed: boolean;
}

export interface TopExerciseRow {
  session_id: string;
  exercise_name: string;
  completed_sets: number;
  best_weight_kg: number | null;
  best_reps: number | null;
}

/**
 * One exercise of a post: its best values in that session next to the best
 * values of the author's earlier completed sessions (same exercise key).
 * `has_previous` is false the first time the exercise is logged.
 */
export interface ExerciseBestsRow {
  session_id: string;
  exercise_name: string;
  best_weight_kg: number | null;
  best_weight_reps: number | null;
  best_one_rep_max_kg: number | null;
  best_one_rep_max_weight_kg: number | null;
  best_one_rep_max_reps: number | null;
  best_bodyweight_reps: number | null;
  has_previous: boolean;
  prev_weight_kg: number | null;
  prev_one_rep_max_kg: number | null;
  prev_bodyweight_reps: number | null;
}

export interface RecentKudoRow extends UserMiniRow {
  session_id: string;
}

export interface CommentRow {
  id: string;
  session_id: string;
  user_id: string;
  body: string;
  created_at: Date;
  /** created_at with µs precision, for keyset cursors. */
  cursor_created_at: string;
  first_name: string;
  last_name: string;
  handle: string;
  avatar_url: string | null;
}

export interface CommentOwnerRow {
  id: string;
  user_id: string;
}

const POST_SELECT = `
  SELECT
    ts.id,
    ts.user_id,
    ts.plan_name,
    ts.note,
    ts.started_at,
    ts.finished_at,
    ${sessionDurationSecSql("ts")} AS duration_sec,
    ${cursorTimestampSql("ts.started_at")} AS cursor_started_at,
    u.first_name AS author_first_name,
    u.last_name AS author_last_name,
    u.handle AS author_handle,
    u.avatar_url AS author_avatar_url
  FROM training_sessions ts
  JOIN users u ON u.id = ts.user_id
`;

/**
 * Completed, stat-counting sets with parsed numbers and an exercise key —
 * the same key the app uses for records: the trimmed, lower-cased name (the
 * exercise id differs between devices and the server), or the id when the
 * name is blank. `one_rep_max_kg` is the Epley estimate.
 */
const scoredSetsSql = (sessionFilter: string): string => `
  SELECT
    tse.session_id,
    tse.position,
    tse.id AS exercise_row_id,
    tss.position AS set_position,
    btrim(tse.exercise_name) AS exercise_name,
    CASE WHEN btrim(tse.exercise_name) <> ''
         THEN 'name:' || lower(btrim(tse.exercise_name))
         ELSE 'id:' || COALESCE(tse.exercise_id::text, '')
    END AS exercise_key,
    p.weight_kg,
    p.reps,
    CASE WHEN p.weight_kg > 0 AND p.reps > 0
         THEN CASE WHEN p.reps = 1 THEN p.weight_kg
                   ELSE p.weight_kg * (1 + p.reps / 30.0) END
    END AS one_rep_max_kg
  FROM training_session_exercises tse
  JOIN training_session_sets tss ON tss.session_exercise_id = tse.id
  CROSS JOIN LATERAL (
    SELECT
      ${parsedWeightSql("tss.actual_weight")}::float8 AS weight_kg,
      ${parsedRepsSql("tss.actual_reps")}::float8 AS reps
  ) p
  WHERE ${sessionFilter}
    AND tss.completed = true
    AND ${countsTowardStatsSql("tss")}
`;

const COMMENT_COLUMNS = `
  c.id,
  c.session_id,
  c.user_id,
  c.body,
  c.created_at,
  ${cursorTimestampSql("c.created_at")} AS cursor_created_at,
  u.first_name,
  u.last_name,
  u.handle,
  u.avatar_url
`;

export const feedRepository = {
  /** Shared, completed posts of the viewer and everyone they follow. */
  listFeed: async (
    viewerId: string,
    limit: number,
    cursor?: KeysetCursor,
  ): Promise<PostRow[]> => {
    const pool = requirePool();
    const params: unknown[] = [viewerId, limit];
    let cursorClause = "";
    if (cursor) {
      params.push(cursor.at, cursor.id);
      cursorClause = "AND (ts.started_at, ts.id) < ($3::timestamptz, $4::uuid)";
    }
    const { rows } = await pool.query(
      `${POST_SELECT}
       WHERE ts.status = 'completed'
         AND ts.shared_to_profile = true
         AND (
           ts.user_id = $1
           OR ts.user_id IN (
             SELECT f.following_id FROM user_follows f WHERE f.follower_id = $1
           )
         )
         ${cursorClause}
       ORDER BY ts.started_at DESC, ts.id DESC
       LIMIT $2`,
      params,
    );
    return rows as PostRow[];
  },

  /** Shared, completed posts of one author (their profile timeline). */
  listUserPosts: async (
    authorId: string,
    limit: number,
    cursor?: KeysetCursor,
  ): Promise<PostRow[]> => {
    const pool = requirePool();
    const params: unknown[] = [authorId, limit];
    let cursorClause = "";
    if (cursor) {
      params.push(cursor.at, cursor.id);
      cursorClause = "AND (ts.started_at, ts.id) < ($3::timestamptz, $4::uuid)";
    }
    const { rows } = await pool.query(
      `${POST_SELECT}
       WHERE ts.user_id = $1
         AND ts.status = 'completed'
         AND ts.shared_to_profile = true
         ${cursorClause}
       ORDER BY ts.started_at DESC, ts.id DESC
       LIMIT $2`,
      params,
    );
    return rows as PostRow[];
  },

  /** A completed session visible to the viewer (shared, or their own). */
  findVisiblePost: async (
    viewerId: string,
    sessionId: string,
  ): Promise<PostRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `${POST_SELECT}
       WHERE ts.id = $1::uuid
         AND ts.status = 'completed'
         AND (ts.shared_to_profile = true OR ts.user_id = $2)`,
      [sessionId, viewerId],
    );
    return rows[0] as PostRow | undefined;
  },

  findPostStats: async (sessionIds: string[]): Promise<PostStatsRow[]> => {
    if (sessionIds.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT
         s.id AS session_id,
         COALESCE(ec.exercises_count, 0) AS exercises_count,
         COALESCE(sc.completed_sets_count, 0) AS completed_sets_count,
         COALESCE(sc.total_volume_kg, 0) AS total_volume_kg,
         COALESCE(mu.muscles, '{}'::text[]) AS muscles
       FROM unnest($1::uuid[]) AS s(id)
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS exercises_count
         FROM training_session_exercises tse
         WHERE tse.session_id = s.id
       ) ec ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS completed_sets_count,
           COALESCE(SUM(${setVolumeSql("tss.actual_weight", "tss.actual_reps")}), 0)::float8 AS total_volume_kg
         FROM training_session_exercises tse
         JOIN training_session_sets tss ON tss.session_exercise_id = tse.id
         WHERE tse.session_id = s.id AND tss.completed = true
           AND ${countsTowardStatsSql("tss")}
       ) sc ON true
       LEFT JOIN LATERAL (
         -- distinct muscles, ordered by first appearance (exercise position,
         -- then order within the exercise's muscle list)
         SELECT array_agg(m.muscle ORDER BY m.position, m.exercise_id, m.ord) AS muscles
         FROM (
           SELECT DISTINCT ON (mm.muscle)
             mm.muscle, tse.position, tse.id AS exercise_id, mm.ord
           FROM training_session_exercises tse
           CROSS JOIN LATERAL unnest(tse.exercise_muscles) WITH ORDINALITY AS mm(muscle, ord)
           WHERE tse.session_id = s.id AND btrim(mm.muscle) <> ''
           ORDER BY mm.muscle, tse.position, tse.id, mm.ord
         ) m
       ) mu ON true`,
      [sessionIds],
    );
    return rows as PostStatsRow[];
  },

  /** Kudos/comment counts and the viewer's kudo flag for many sessions. */
  findSocialStats: async (
    sessionIds: string[],
    viewerId: string,
  ): Promise<PostSocialRow[]> => {
    if (sessionIds.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT
         s.id AS session_id,
         (SELECT COUNT(*)::int FROM session_kudos k WHERE k.session_id = s.id) AS kudos_count,
         (SELECT COUNT(*)::int FROM session_comments c WHERE c.session_id = s.id) AS comment_count,
         EXISTS (
           SELECT 1 FROM session_kudos k WHERE k.session_id = s.id AND k.user_id = $2
         ) AS has_kudoed
       FROM unnest($1::uuid[]) AS s(id)`,
      [sessionIds, viewerId],
    );
    return rows as PostSocialRow[];
  },

  /**
   * First `perSession` exercises (by position) with at least one completed
   * set; best set = highest parsable weight, tie → more reps, then set order.
   */
  findTopExercises: async (
    sessionIds: string[],
    perSession: number,
  ): Promise<TopExerciseRow[]> => {
    if (sessionIds.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT t.session_id, t.exercise_name, t.completed_sets, t.best_weight_kg, t.best_reps
       FROM (
         SELECT
           tse.session_id,
           tse.exercise_name,
           tse.position,
           tse.id,
           cs.completed_sets,
           bs.weight_kg AS best_weight_kg,
           bs.reps AS best_reps,
           ROW_NUMBER() OVER (
             PARTITION BY tse.session_id ORDER BY tse.position, tse.id
           ) AS rn
         FROM training_session_exercises tse
         JOIN LATERAL (
           SELECT COUNT(*)::int AS completed_sets
           FROM training_session_sets tss
           WHERE tss.session_exercise_id = tse.id AND tss.completed = true
             AND ${countsTowardStatsSql("tss")}
         ) cs ON cs.completed_sets > 0
         LEFT JOIN LATERAL (
           SELECT p.weight_kg::float8 AS weight_kg, p.reps::float8 AS reps
           FROM (
             SELECT
               ${parsedWeightSql("tss.actual_weight")} AS weight_kg,
               ${parsedRepsSql("tss.actual_reps")} AS reps,
               tss.position,
               tss.id
             FROM training_session_sets tss
             WHERE tss.session_exercise_id = tse.id AND tss.completed = true
               AND ${countsTowardStatsSql("tss")}
           ) p
           WHERE p.weight_kg IS NOT NULL
           ORDER BY p.weight_kg DESC, p.reps DESC NULLS LAST, p.position ASC, p.id ASC
           LIMIT 1
         ) bs ON true
         WHERE tse.session_id = ANY($1::uuid[])
       ) t
       WHERE t.rn <= $2
       ORDER BY t.session_id, t.position, t.id`,
      [sessionIds, perSession],
    );
    return rows as TopExerciseRow[];
  },

  /**
   * Per post and exercise: the session's best weight / estimated 1RM /
   * bodyweight reps and the author's best values from completed sessions
   * started before it. The service decides which of them are new records.
   */
  findExerciseBests: async (sessionIds: string[]): Promise<ExerciseBestsRow[]> => {
    if (sessionIds.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `WITH cur AS (
         ${scoredSetsSql("tse.session_id = ANY($1::uuid[])")}
       ),
       tops AS (
         SELECT
           cur.session_id,
           cur.exercise_key,
           (array_agg(cur.exercise_name ORDER BY cur.position, cur.exercise_row_id))[1] AS exercise_name,
           MIN(cur.position) AS position,
           MAX(cur.weight_kg) FILTER (WHERE cur.weight_kg > 0) AS best_weight_kg,
           (array_agg(cur.reps ORDER BY cur.weight_kg DESC, cur.reps DESC NULLS LAST, cur.position, cur.set_position)
              FILTER (WHERE cur.weight_kg > 0))[1] AS best_weight_reps,
           MAX(cur.one_rep_max_kg) AS best_one_rep_max_kg,
           (array_agg(cur.weight_kg ORDER BY cur.one_rep_max_kg DESC, cur.position, cur.set_position)
              FILTER (WHERE cur.one_rep_max_kg IS NOT NULL))[1] AS best_one_rep_max_weight_kg,
           (array_agg(cur.reps ORDER BY cur.one_rep_max_kg DESC, cur.position, cur.set_position)
              FILTER (WHERE cur.one_rep_max_kg IS NOT NULL))[1] AS best_one_rep_max_reps,
           MAX(cur.reps) FILTER (WHERE COALESCE(cur.weight_kg, 0) <= 0) AS best_bodyweight_reps
         FROM cur
         GROUP BY cur.session_id, cur.exercise_key
       ),
       -- one pass over each author's earlier history per post (not per
       -- exercise), limited to the exercises that post contains
       prev AS (
         SELECT
           post.id AS session_id,
           e.exercise_key,
           MAX(e.weight_kg) FILTER (WHERE e.weight_kg > 0) AS weight_kg,
           MAX(e.one_rep_max_kg) AS one_rep_max_kg,
           MAX(e.reps) FILTER (WHERE COALESCE(e.weight_kg, 0) <= 0) AS bodyweight_reps
         FROM training_sessions post
         CROSS JOIN LATERAL (
           ${scoredSetsSql(`tse.session_id IN (
             SELECT earlier.id FROM training_sessions earlier
             WHERE earlier.user_id = post.user_id
               AND earlier.status = 'completed'
               AND earlier.started_at < post.started_at
           )`)}
         ) e
         WHERE post.id = ANY($1::uuid[])
           AND e.exercise_key IN (
             SELECT tops.exercise_key FROM tops WHERE tops.session_id = post.id
           )
         GROUP BY post.id, e.exercise_key
       )
       SELECT
         t.session_id,
         t.exercise_name,
         t.best_weight_kg,
         t.best_weight_reps,
         t.best_one_rep_max_kg,
         t.best_one_rep_max_weight_kg,
         t.best_one_rep_max_reps,
         t.best_bodyweight_reps,
         prev.session_id IS NOT NULL AS has_previous,
         prev.weight_kg AS prev_weight_kg,
         prev.one_rep_max_kg AS prev_one_rep_max_kg,
         prev.bodyweight_reps AS prev_bodyweight_reps
       FROM tops t
       LEFT JOIN prev
         ON prev.session_id = t.session_id AND prev.exercise_key = t.exercise_key
       ORDER BY t.session_id, t.position, t.exercise_key`,
      [sessionIds],
    );
    return rows as ExerciseBestsRow[];
  },

  findRecentKudos: async (
    sessionIds: string[],
    perSession: number,
  ): Promise<RecentKudoRow[]> => {
    if (sessionIds.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT s.id AS session_id, u.id, u.first_name, u.last_name, u.handle, u.avatar_url
       FROM unnest($1::uuid[]) AS s(id)
       CROSS JOIN LATERAL (
         SELECT k.user_id, k.created_at
         FROM session_kudos k
         WHERE k.session_id = s.id
         ORDER BY k.created_at DESC, k.user_id DESC
         LIMIT $2
       ) rk
       JOIN users u ON u.id = rk.user_id
       ORDER BY s.id, rk.created_at DESC, rk.user_id DESC`,
      [sessionIds, perSession],
    );
    return rows as RecentKudoRow[];
  },

  insertKudo: async (sessionId: string, userId: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `INSERT INTO session_kudos (session_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [sessionId, userId],
    );
  },

  deleteKudo: async (sessionId: string, userId: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `DELETE FROM session_kudos WHERE session_id = $1 AND user_id = $2`,
      [sessionId, userId],
    );
  },

  countKudos: async (sessionId: string): Promise<number> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS kudos_count FROM session_kudos WHERE session_id = $1`,
      [sessionId],
    );
    return (rows[0] as { kudos_count?: number } | undefined)?.kudos_count ?? 0;
  },

  listKudos: async (
    sessionId: string,
    viewerId: string,
    limit: number,
    offset: number,
  ): Promise<FollowingUserRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.handle, u.avatar_url,
              EXISTS (
                SELECT 1 FROM user_follows vf
                WHERE vf.follower_id = $2 AND vf.following_id = u.id
              ) AS is_following
       FROM session_kudos k
       JOIN users u ON u.id = k.user_id
       WHERE k.session_id = $1
       ORDER BY k.created_at DESC, u.id DESC
       LIMIT $3 OFFSET $4`,
      [sessionId, viewerId, limit, offset],
    );
    return rows as FollowingUserRow[];
  },

  /** Oldest first; the cursor continues towards newer comments. */
  listComments: async (
    sessionId: string,
    limit: number,
    cursor?: KeysetCursor,
  ): Promise<CommentRow[]> => {
    const pool = requirePool();
    const params: unknown[] = [sessionId, limit];
    let cursorClause = "";
    if (cursor) {
      params.push(cursor.at, cursor.id);
      cursorClause = "AND (c.created_at, c.id) > ($3::timestamptz, $4::uuid)";
    }
    const { rows } = await pool.query(
      `SELECT ${COMMENT_COLUMNS}
       FROM session_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.session_id = $1
         ${cursorClause}
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $2`,
      params,
    );
    return rows as CommentRow[];
  },

  insertComment: async (
    sessionId: string,
    userId: string,
    body: string,
  ): Promise<CommentRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `WITH c AS (
         INSERT INTO session_comments (session_id, user_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, session_id, user_id, body, created_at
       )
       SELECT ${COMMENT_COLUMNS}
       FROM c
       JOIN users u ON u.id = c.user_id`,
      [sessionId, userId, body],
    );
    return rows[0] as CommentRow | undefined;
  },

  findCommentOnPost: async (
    commentId: string,
    sessionId: string,
  ): Promise<CommentOwnerRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT id, user_id FROM session_comments WHERE id = $1 AND session_id = $2`,
      [commentId, sessionId],
    );
    return rows[0] as CommentOwnerRow | undefined;
  },

  deleteComment: async (commentId: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(`DELETE FROM session_comments WHERE id = $1`, [commentId]);
  },

  /**
   * Users the viewer does not follow (excluding self), ranked by completed
   * shared sessions in the last 30 days, then newest accounts.
   */
  listSuggestedUsers: async (
    viewerId: string,
    limit: number,
  ): Promise<FollowingUserRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.handle, u.avatar_url,
              false AS is_following
       FROM users u
       LEFT JOIN (
         SELECT ts.user_id, COUNT(*)::int AS recent_count
         FROM training_sessions ts
         WHERE ts.status = 'completed'
           AND ts.shared_to_profile = true
           AND ts.started_at >= now() - interval '30 days'
         GROUP BY ts.user_id
       ) activity ON activity.user_id = u.id
       WHERE u.id <> $1
         AND NOT EXISTS (
           SELECT 1 FROM user_follows f
           WHERE f.follower_id = $1 AND f.following_id = u.id
         )
       ORDER BY COALESCE(activity.recent_count, 0) DESC, u.created_at DESC, u.id DESC
       LIMIT $2`,
      [viewerId, limit],
    );
    return rows as FollowingUserRow[];
  },
};
