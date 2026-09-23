import path from "node:path";

import { AppError } from "../../common/errors.js";
import { logger, serializeError } from "../../common/logger.js";
import { isForeignKeyViolation, isUniqueViolation } from "../../common/pg-errors.js";
import { diskPathFromPublicUrl, safeUnlink } from "../../common/uploads.js";
import { AVATARS_PUBLIC_PREFIX } from "./profile.avatar-upload.js";
import {
  profileRepository,
  type FollowingUserRow,
  type OwnProfileRow,
  type ProfileRelationshipRow,
  type ProfileStatsRow,
  type ProfileUpdateFields,
  type ProfileUserRow,
} from "./profile.repository.js";

export const formatFollowingUser = (row: FollowingUserRow) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  handle: row.handle,
  avatarUrl: row.avatar_url,
  isFollowing: row.is_following === true,
});

const NO_RELATIONSHIP: ProfileRelationshipRow = {
  is_following: false,
  is_followed_by: false,
};

const formatProfile = (
  row: ProfileUserRow,
  stats: ProfileStatsRow,
  isOwnProfile: boolean,
  relationship: ProfileRelationshipRow = NO_RELATIONSHIP,
) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  handle: row.handle,
  bio: row.bio,
  avatarUrl: row.avatar_url,
  stats: {
    followingCount: stats.following_count,
    followersCount: stats.followers_count,
    workoutsCount: stats.workouts_count,
  },
  isOwnProfile,
  isFollowing: isOwnProfile ? false : relationship.is_following,
  isFollowedBy: isOwnProfile ? false : relationship.is_followed_by,
});

/** /profile/me* only — the details are private to their owner. */
const formatOwnProfile = (row: OwnProfileRow, stats: ProfileStatsRow) => ({
  ...formatProfile(row, stats, true),
  onboardingCompleted: row.onboarding_completed === true,
  details: {
    birthDate: row.birth_date,
    gender: row.gender,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    trainingGoal: row.training_goal,
    experienceLevel: row.experience_level,
    weeklyTrainingDays: row.weekly_training_days,
  },
});

/** Best-effort removal; only files we manage under /uploads/avatars/ are touched. */
const removeManagedAvatar = async (avatarUrl: string | null): Promise<void> => {
  if (!avatarUrl || !avatarUrl.startsWith(AVATARS_PUBLIC_PREFIX)) return;
  const fileName = path.basename(avatarUrl);
  try {
    await safeUnlink(
      diskPathFromPublicUrl(`${AVATARS_PUBLIC_PREFIX}${fileName}`),
    );
  } catch (e: unknown) {
    logger.warn("[profile] failed to remove avatar file", { avatarUrl, error: serializeError(e) });
  }
};

const removeUploadedFile = async (diskPath: string): Promise<void> => {
  try {
    await safeUnlink(diskPath);
  } catch (e: unknown) {
    logger.warn("[profile] failed to remove uploaded file", { diskPath, error: serializeError(e) });
  }
};

const ensureUserExists = async (userId: string): Promise<void> => {
  const exists = await profileRepository.userExists(userId);
  if (!exists) {
    throw new AppError(404, "user_not_found");
  }
};


export const profileService = {
  getOwnProfile: async (userId: string) => {
    const [row, stats] = await Promise.all([
      profileRepository.findOwnProfileById(userId),
      profileRepository.findStatsByUserId(userId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return formatOwnProfile(row, stats);
  },

  getUserProfile: async (viewerId: string, targetUserId: string) => {
    const isOwnProfile = viewerId === targetUserId;
    const [row, stats, relationship] = await Promise.all([
      profileRepository.findProfileById(targetUserId),
      profileRepository.findStatsByUserId(targetUserId),
      isOwnProfile
        ? Promise.resolve(NO_RELATIONSHIP)
        : profileRepository.findRelationship(viewerId, targetUserId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return formatProfile(row, stats, isOwnProfile, relationship);
  },

  updateProfile: async (userId: string, fields: ProfileUpdateFields) => {
    const [row, stats] = await Promise.all([
      profileRepository.updateProfile(userId, fields).catch((e: unknown) => {
        if (isUniqueViolation(e, "users_handle_unique_idx")) {
          throw new AppError(409, "handle_taken");
        }
        throw e;
      }),
      profileRepository.findStatsByUserId(userId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return formatOwnProfile(row, stats);
  },

  completeOnboarding: async (userId: string) => {
    const [row, stats] = await Promise.all([
      profileRepository.completeOnboarding(userId),
      profileRepository.findStatsByUserId(userId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return formatOwnProfile(row, stats);
  },

  uploadAvatar: async (
    userId: string,
    publicPath: string,
    savedDiskPath: string,
  ) => {
    let row: Awaited<ReturnType<typeof profileRepository.updateAvatarUrl>>;
    try {
      row = await profileRepository.updateAvatarUrl(userId, publicPath);
    } catch (e: unknown) {
      await removeUploadedFile(savedDiskPath);
      throw e;
    }
    if (!row) {
      await removeUploadedFile(savedDiskPath);
      throw new AppError(404, "user_not_found");
    }

    if (row.previous_avatar_url && row.previous_avatar_url !== publicPath) {
      await removeManagedAvatar(row.previous_avatar_url);
    }

    const stats = await profileRepository.findStatsByUserId(userId);
    return formatOwnProfile(row, stats);
  },

  deleteAvatar: async (userId: string) => {
    const [row, stats] = await Promise.all([
      profileRepository.updateAvatarUrl(userId, null),
      profileRepository.findStatsByUserId(userId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    await removeManagedAvatar(row.previous_avatar_url);
    return formatOwnProfile(row, stats);
  },

  follow: async (viewerId: string, targetUserId: string) => {
    if (viewerId === targetUserId) {
      throw new AppError(400, "cannot_follow_self");
    }
    await ensureUserExists(targetUserId);
    try {
      await profileRepository.insertFollow(viewerId, targetUserId);
    } catch (e: unknown) {
      // Target (or viewer) removed between the existence check and the insert.
      if (isForeignKeyViolation(e)) {
        throw new AppError(404, "user_not_found");
      }
      throw e;
    }
    const followersCount = await profileRepository.countFollowers(targetUserId);
    return { isFollowing: true as const, followersCount };
  },

  unfollow: async (viewerId: string, targetUserId: string) => {
    await ensureUserExists(targetUserId);
    await profileRepository.deleteFollow(viewerId, targetUserId);
    const followersCount = await profileRepository.countFollowers(targetUserId);
    return { isFollowing: false as const, followersCount };
  },

  getFollowing: async (userId: string, limit: number, offset: number) => {
    const rows = await profileRepository.listFollowing(
      userId,
      userId,
      limit,
      offset,
    );
    return rows.map(formatFollowingUser);
  },

  getFollowers: async (userId: string, limit: number, offset: number) => {
    const rows = await profileRepository.listFollowers(
      userId,
      userId,
      limit,
      offset,
    );
    return rows.map(formatFollowingUser);
  },

  getUserFollowing: async (
    viewerId: string,
    targetUserId: string,
    limit: number,
    offset: number,
  ) => {
    const [exists, rows] = await Promise.all([
      profileRepository.userExists(targetUserId),
      profileRepository.listFollowing(targetUserId, viewerId, limit, offset),
    ]);
    if (!exists) {
      throw new AppError(404, "user_not_found");
    }
    return rows.map(formatFollowingUser);
  },

  getUserFollowers: async (
    viewerId: string,
    targetUserId: string,
    limit: number,
    offset: number,
  ) => {
    const [exists, rows] = await Promise.all([
      profileRepository.userExists(targetUserId),
      profileRepository.listFollowers(targetUserId, viewerId, limit, offset),
    ]);
    if (!exists) {
      throw new AppError(404, "user_not_found");
    }
    return rows.map(formatFollowingUser);
  },

  searchUsers: async (viewerId: string, query: string, limit: number) => {
    const rows = await profileRepository.searchUsers(
      viewerId,
      query.trim(),
      limit,
    );
    return rows.map(formatFollowingUser);
  },

};
