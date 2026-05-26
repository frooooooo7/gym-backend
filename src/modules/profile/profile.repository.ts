import { requirePool } from "../../db/require-pool.js";

export interface ProfileUserRow {
  id: string;
  first_name: string;
  last_name: string;
  handle: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface ProfileStatsRow {
  following_count: number;
  followers_count: number;
  workouts_count: number;
}

export interface ProfileActivityRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  duration_sec: number;
  plan_name: string;
  exercises_count: number;
  completed_sets_count: number;
  volume_kg: number;
}

export interface FollowingUserRow {
  id: string;
  first_name: string;
  last_name: string;
  handle: string;
  avatar_url: string | null;
}

export const profileRepository = {
  findProfileById: async (userId: string): Promise<ProfileUserRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, handle, bio, avatar_url
       FROM users
       WHERE id = $1`,
      [userId],
    );
    return rows[0] as ProfileUserRow | undefined;
  },

  findStatsByUserId: async (userId: string): Promise<ProfileStatsRow> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM user_follows WHERE follower_id = $1) AS following_count,
         (SELECT COUNT(*)::int FROM user_follows WHERE following_id = $1) AS followers_count,
         (SELECT COUNT(*)::int FROM training_sessions WHERE user_id = $1 AND status = 'completed') AS workouts_count`,
      [userId],
    );
    return rows[0] as ProfileStatsRow;
  },

  updateBio: async (userId: string, bio: string | null): Promise<ProfileUserRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE users
       SET bio = $2
       WHERE id = $1
       RETURNING id, first_name, last_name, handle, bio, avatar_url`,
      [userId, bio],
    );
    return rows[0] as ProfileUserRow | undefined;
  },

  listFollowing: async (
    userId: string,
    limit: number,
    offset: number,
  ): Promise<FollowingUserRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.handle, u.avatar_url
       FROM user_follows uf
       JOIN users u ON u.id = uf.following_id
       WHERE uf.follower_id = $1
       ORDER BY uf.created_at DESC, u.handle ASC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return rows as FollowingUserRow[];
  },

  listFollowers: async (
    userId: string,
    limit: number,
    offset: number,
  ): Promise<FollowingUserRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.handle, u.avatar_url
       FROM user_follows uf
       JOIN users u ON u.id = uf.follower_id
       WHERE uf.following_id = $1
       ORDER BY uf.created_at DESC, u.handle ASC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return rows as FollowingUserRow[];
  },

  searchUsers: async (
    viewerId: string,
    query: string,
    limit: number,
  ): Promise<FollowingUserRow[]> => {
    const pool = requirePool();
    const pattern = `%${query.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, handle, avatar_url
       FROM users
       WHERE id <> $1
         AND (
           lower(first_name || ' ' || last_name) LIKE $2
           OR lower(handle) LIKE $2
         )
       ORDER BY handle ASC
       LIMIT $3`,
      [viewerId, pattern, limit],
    );
    return rows as FollowingUserRow[];
  },

  listRecentActivities: async (
    userId: string,
    limit: number,
  ): Promise<ProfileActivityRow[]> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT
         ts.id,
         ts.started_at,
         ts.finished_at,
         COALESCE(
           GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(ts.finished_at, now()) - ts.started_at)))::int),
           0
         ) AS duration_sec,
         ts.plan_name,
         COALESCE(ec.exercises_count, 0) AS exercises_count,
         COALESCE(sc.completed_sets_count, 0) AS completed_sets_count,
         COALESCE(vc.volume_kg, 0) AS volume_kg
       FROM training_sessions ts
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS exercises_count
         FROM training_session_exercises tse
         WHERE tse.session_id = ts.id
       ) ec ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS completed_sets_count
         FROM training_session_exercises tse
         JOIN training_session_sets tss ON tss.session_exercise_id = tse.id
         WHERE tse.session_id = ts.id AND tss.completed = true
       ) sc ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(
           COALESCE(NULLIF(regexp_replace(tss.actual_weight, '[^0-9.,]', '', 'g'), ''), '0')::numeric
           * COALESCE(NULLIF(regexp_replace(tss.actual_reps, '[^0-9]', '', 'g'), ''), '0')::numeric
         ), 0)::float AS volume_kg
         FROM training_session_exercises tse
         JOIN training_session_sets tss ON tss.session_exercise_id = tse.id
         WHERE tse.session_id = ts.id AND tss.completed = true
       ) vc ON true
       WHERE ts.user_id = $1 AND ts.status = 'completed'
       ORDER BY ts.started_at DESC, ts.id DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows as ProfileActivityRow[];
  },
};
