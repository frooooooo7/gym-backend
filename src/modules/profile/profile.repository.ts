import { requirePool } from "../../db/require-pool.js";

export interface ProfileUserRow {
  id: string;
  first_name: string;
  last_name: string;
  handle: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface ProfileUserWithPreviousAvatarRow extends ProfileUserRow {
  previous_avatar_url: string | null;
}

export interface ProfileStatsRow {
  following_count: number;
  followers_count: number;
  workouts_count: number;
}

export interface ProfileRelationshipRow {
  is_following: boolean;
  is_followed_by: boolean;
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
  is_following: boolean;
}

export interface ProfileUpdateFields {
  firstName?: string;
  lastName?: string;
  bio?: string | null;
}

const PROFILE_COLUMNS = "id, first_name, last_name, handle, bio, avatar_url";

export const profileRepository = {
  findProfileById: async (userId: string): Promise<ProfileUserRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ${PROFILE_COLUMNS}
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

  findRelationship: async (
    viewerId: string,
    targetUserId: string,
  ): Promise<ProfileRelationshipRow> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2
         ) AS is_following,
         EXISTS (
           SELECT 1 FROM user_follows WHERE follower_id = $2 AND following_id = $1
         ) AS is_followed_by`,
      [viewerId, targetUserId],
    );
    const row = rows[0] as ProfileRelationshipRow | undefined;
    return {
      is_following: row?.is_following === true,
      is_followed_by: row?.is_followed_by === true,
    };
  },

  updateProfile: async (
    userId: string,
    fields: ProfileUpdateFields,
  ): Promise<ProfileUserRow | undefined> => {
    const pool = requirePool();
    const assignments: string[] = [];
    const values: unknown[] = [userId];
    const push = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if (fields.firstName !== undefined) push("first_name", fields.firstName);
    if (fields.lastName !== undefined) push("last_name", fields.lastName);
    if (fields.bio !== undefined) push("bio", fields.bio);
    if (assignments.length === 0) {
      return profileRepository.findProfileById(userId);
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET ${assignments.join(", ")}
       WHERE id = $1
       RETURNING ${PROFILE_COLUMNS}`,
      values,
    );
    return rows[0] as ProfileUserRow | undefined;
  },

  /** Sets avatar_url and returns the updated row plus the value it replaced. */
  updateAvatarUrl: async (
    userId: string,
    avatarUrl: string | null,
  ): Promise<ProfileUserWithPreviousAvatarRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE users u
       SET avatar_url = $2
       FROM users prev
       WHERE u.id = $1 AND prev.id = u.id
       RETURNING u.id, u.first_name, u.last_name, u.handle, u.bio, u.avatar_url,
                 prev.avatar_url AS previous_avatar_url`,
      [userId, avatarUrl],
    );
    return rows[0] as ProfileUserWithPreviousAvatarRow | undefined;
  },

  userExists: async (userId: string): Promise<boolean> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE id = $1`,
      [userId],
    );
    return rows.length > 0;
  },

  insertFollow: async (followerId: string, followingId: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `INSERT INTO user_follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [followerId, followingId],
    );
  },

  deleteFollow: async (followerId: string, followingId: string): Promise<void> => {
    const pool = requirePool();
    await pool.query(
      `DELETE FROM user_follows
       WHERE follower_id = $1 AND following_id = $2`,
      [followerId, followingId],
    );
  },

  countFollowers: async (userId: string): Promise<number> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS followers_count
       FROM user_follows
       WHERE following_id = $1`,
      [userId],
    );
    return (rows[0] as { followers_count?: number } | undefined)?.followers_count ?? 0;
  },

  listFollowing: async (
    userId: string,
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
       FROM user_follows uf
       JOIN users u ON u.id = uf.following_id
       WHERE uf.follower_id = $1
       ORDER BY uf.created_at DESC, u.handle ASC
       LIMIT $3 OFFSET $4`,
      [userId, viewerId, limit, offset],
    );
    return rows as FollowingUserRow[];
  },

  listFollowers: async (
    userId: string,
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
       FROM user_follows uf
       JOIN users u ON u.id = uf.follower_id
       WHERE uf.following_id = $1
       ORDER BY uf.created_at DESC, u.handle ASC
       LIMIT $3 OFFSET $4`,
      [userId, viewerId, limit, offset],
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
      `SELECT u.id, u.first_name, u.last_name, u.handle, u.avatar_url,
              EXISTS (
                SELECT 1 FROM user_follows vf
                WHERE vf.follower_id = $1 AND vf.following_id = u.id
              ) AS is_following
       FROM users u
       WHERE u.id <> $1
         AND (
           lower(u.first_name || ' ' || u.last_name) LIKE $2
           OR lower(u.handle) LIKE $2
         )
       ORDER BY u.handle ASC
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
         COALESCE(sc.volume_kg, 0) AS volume_kg
       FROM training_sessions ts
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS exercises_count
         FROM training_session_exercises tse
         WHERE tse.session_id = ts.id
       ) ec ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS completed_sets_count,
           COALESCE(SUM(
             COALESCE(NULLIF(regexp_replace(tss.actual_weight, '[^0-9.,]', '', 'g'), ''), '0')::numeric
             * COALESCE(NULLIF(regexp_replace(tss.actual_reps, '[^0-9]', '', 'g'), ''), '0')::numeric
           ), 0)::float AS volume_kg
         FROM training_session_exercises tse
         JOIN training_session_sets tss ON tss.session_exercise_id = tse.id
         WHERE tse.session_id = ts.id AND tss.completed = true
       ) sc ON true
       WHERE ts.user_id = $1
         AND ts.status = 'completed'
         AND ts.shared_to_profile = true
       ORDER BY ts.started_at DESC, ts.id DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows as ProfileActivityRow[];
  },
};
