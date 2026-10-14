import { requirePool } from "../../db/require-pool.js";
import type { UserMiniRow } from "../feed/feed.repository.js";

export interface KudosNotificationRow {
  session_id: string;
  plan_name: string;
  at: Date;
  actor_count: number;
  /** Newest first, at most two. */
  actor_ids: string[];
}

export interface FollowNotificationRow {
  actor_id: string;
  at: Date;
  is_following: boolean;
}

export interface PlanCopyNotificationRow {
  copy_id: string;
  actor_id: string;
  at: Date;
  plan_id: string | null;
  plan_name: string;
}

export interface RecordCandidateRow {
  session_id: string;
  actor_id: string;
  at: Date;
  plan_name: string;
}

export interface NotificationMarkRow {
  key: string;
  read_at: Date | null;
  dismissed_at: Date | null;
}

export interface NotificationStateRow {
  notifications_read_at: Date | null;
  notification_settings: Record<string, unknown>;
}

const LIST_LIMIT = 50;
const RECORD_CANDIDATES_LIMIT = 20;

export const notificationsRepository = {
  findState: async (
    userId: string,
  ): Promise<NotificationStateRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT notifications_read_at, notification_settings
       FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0] as NotificationStateRow | undefined;
  },

  /** Kudos on the user's sessions, one row per session. */
  listKudos: async (
    userId: string,
    since: Date,
  ): Promise<KudosNotificationRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ts.id AS session_id,
              ts.plan_name,
              MAX(k.created_at) AS at,
              COUNT(*)::int AS actor_count,
              (array_agg(k.user_id ORDER BY k.created_at DESC, k.user_id DESC))[1:2]
                AS actor_ids
       FROM training_sessions ts
       JOIN session_kudos k ON k.session_id = ts.id AND k.user_id <> ts.user_id
       WHERE ts.user_id = $1
       GROUP BY ts.id, ts.plan_name
       HAVING MAX(k.created_at) > $2
       ORDER BY at DESC
       LIMIT ${LIST_LIMIT}`,
      [userId, since],
    );
    return rows as KudosNotificationRow[];
  },

  listFollowers: async (
    userId: string,
    since: Date,
  ): Promise<FollowNotificationRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT f.follower_id AS actor_id,
              f.created_at AS at,
              EXISTS (
                SELECT 1 FROM user_follows back
                WHERE back.follower_id = $1 AND back.following_id = f.follower_id
              ) AS is_following
       FROM user_follows f
       WHERE f.following_id = $1 AND f.created_at > $2
       ORDER BY f.created_at DESC
       LIMIT ${LIST_LIMIT}`,
      [userId, since],
    );
    return rows as FollowNotificationRow[];
  },

  listPlanCopies: async (
    userId: string,
    since: Date,
  ): Promise<PlanCopyNotificationRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT copy.id AS copy_id,
              copy.user_id AS actor_id,
              copy.created_at AS at,
              src.id AS plan_id,
              COALESCE(src.name, copy.name) AS plan_name
       FROM training_plans copy
       LEFT JOIN training_plans src
         ON src.id = copy.copied_from_plan_id AND src.user_id = $1
       WHERE copy.copied_from_user_id = $1
         AND copy.user_id <> $1
         AND copy.created_at > $2
       ORDER BY copy.created_at DESC
       LIMIT ${LIST_LIMIT}`,
      [userId, since],
    );
    return rows as PlanCopyNotificationRow[];
  },

  /** Shared workouts of followed people — the service keeps those with records. */
  listRecordCandidates: async (
    userId: string,
    since: Date,
  ): Promise<RecordCandidateRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ts.id AS session_id,
              ts.user_id AS actor_id,
              COALESCE(ts.finished_at, ts.started_at) AS at,
              ts.plan_name
       FROM user_follows f
       JOIN training_sessions ts ON ts.user_id = f.following_id
       WHERE f.follower_id = $1
         AND ts.status = 'completed'
         AND ts.shared_to_profile = true
         AND COALESCE(ts.finished_at, ts.started_at) > $2
       ORDER BY ts.started_at DESC
       LIMIT ${RECORD_CANDIDATES_LIMIT}`,
      [userId, since],
    );
    return rows as RecordCandidateRow[];
  },

  findUsers: async (ids: string[]): Promise<UserMiniRow[]> => {
    if (ids.length === 0) return [];
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, handle, avatar_url
       FROM users WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows as UserMiniRow[];
  },

  listMarks: async (userId: string): Promise<NotificationMarkRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT key, read_at, dismissed_at
       FROM notification_marks WHERE user_id = $1`,
      [userId],
    );
    return rows as NotificationMarkRow[];
  },

  markRead: async (userId: string, key: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `INSERT INTO notification_marks (user_id, key, read_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, key) DO UPDATE SET read_at = now()`,
      [userId, key],
    );
  },

  dismiss: async (userId: string, key: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `INSERT INTO notification_marks (user_id, key, read_at, dismissed_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (user_id, key)
       DO UPDATE SET read_at = now(), dismissed_at = now()`,
      [userId, key],
    );
  },

  /** Everything up to now is read; per-item read marks are no longer needed. */
  markAllRead: async (userId: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `WITH cleared AS (
         DELETE FROM notification_marks
         WHERE user_id = $1 AND dismissed_at IS NULL
       )
       UPDATE users SET notifications_read_at = now() WHERE id = $1`,
      [userId],
    );
  },

  /** Drops dismissals older than the listing window — they can never match. */
  pruneMarks: async (userId: string, before: Date): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `DELETE FROM notification_marks
       WHERE user_id = $1 AND COALESCE(dismissed_at, read_at) < $2`,
      [userId, before],
    );
  },

  updateSettings: async (
    userId: string,
    settings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE users
       SET notification_settings = $2::jsonb
       WHERE id = $1
       RETURNING notification_settings`,
      [userId, JSON.stringify(settings)],
    );
    return (rows[0]?.notification_settings ?? {}) as Record<string, unknown>;
  },
};
