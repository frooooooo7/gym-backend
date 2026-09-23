import { requirePool } from "../../db/require-pool.js";
import type {
  ExperienceLevel,
  Gender,
  TrainingGoal,
} from "./profile.schemas.js";

export interface ProfileUserRow {
  id: string;
  first_name: string;
  last_name: string;
  handle: string;
  bio: string | null;
  avatar_url: string | null;
}

/** Own profile — adds the private details only /profile/me* may return. */
export interface OwnProfileRow extends ProfileUserRow {
  /** `YYYY-MM-DD` */
  birth_date: string | null;
  gender: Gender | null;
  height_cm: number | null;
  weight_kg: number | null;
  training_goal: TrainingGoal | null;
  experience_level: ExperienceLevel | null;
  weekly_training_days: number | null;
  onboarding_completed: boolean;
}

export interface ProfileUserWithPreviousAvatarRow extends OwnProfileRow {
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
  handle?: string;
  /** `YYYY-MM-DD` */
  birthDate?: string | null;
  gender?: Gender | null;
  heightCm?: number | null;
  weightKg?: number | null;
  trainingGoal?: TrainingGoal | null;
  experienceLevel?: ExperienceLevel | null;
  weeklyTrainingDays?: number | null;
}

const UPDATABLE_COLUMNS = {
  firstName: "first_name",
  lastName: "last_name",
  bio: "bio",
  handle: "handle",
  birthDate: "birth_date",
  gender: "gender",
  heightCm: "height_cm",
  weightKg: "weight_kg",
  trainingGoal: "training_goal",
  experienceLevel: "experience_level",
  weeklyTrainingDays: "weekly_training_days",
} as const satisfies Record<keyof ProfileUpdateFields, string>;

const PROFILE_COLUMNS = "id, first_name, last_name, handle, bio, avatar_url";

/** Columns of [OwnProfileRow] read from table/alias [t]. */
const ownProfileColumns = (t: string) =>
  `${t}.id, ${t}.first_name, ${t}.last_name, ${t}.handle, ${t}.bio, ${t}.avatar_url,
   to_char(${t}.birth_date, 'YYYY-MM-DD') AS birth_date, ${t}.gender, ${t}.height_cm,
   ${t}.weight_kg::float8 AS weight_kg, ${t}.training_goal, ${t}.experience_level,
   ${t}.weekly_training_days,
   (${t}.onboarding_completed_at IS NOT NULL) AS onboarding_completed`;

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

  findOwnProfileById: async (userId: string): Promise<OwnProfileRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ${ownProfileColumns("users")}
       FROM users
       WHERE id = $1`,
      [userId],
    );
    return rows[0] as OwnProfileRow | undefined;
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
  ): Promise<OwnProfileRow | undefined> => {
    const pool = requirePool();
    const assignments: string[] = [];
    const values: unknown[] = [userId];
    for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = fields[field as keyof ProfileUpdateFields];
      if (value === undefined) continue;
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }
    if (assignments.length === 0) {
      return profileRepository.findOwnProfileById(userId);
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET ${assignments.join(", ")}
       WHERE id = $1
       RETURNING ${ownProfileColumns("users")}`,
      values,
    );
    return rows[0] as OwnProfileRow | undefined;
  },

  /** Idempotent — keeps the first completion time. */
  completeOnboarding: async (userId: string): Promise<OwnProfileRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE users
       SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
       WHERE id = $1
       RETURNING ${ownProfileColumns("users")}`,
      [userId],
    );
    return rows[0] as OwnProfileRow | undefined;
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
       RETURNING ${ownProfileColumns("u")},
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

};
