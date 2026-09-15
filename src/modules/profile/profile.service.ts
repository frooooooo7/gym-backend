import path from "node:path";

import { AppError } from "../../common/errors.js";
import { diskPathFromPublicUrl, safeUnlink } from "../../common/uploads.js";
import { AVATARS_PUBLIC_PREFIX } from "./profile.avatar-upload.js";
import {
  profileRepository,
  type FollowingUserRow,
  type ProfileActivityRow,
  type ProfileRelationshipRow,
  type ProfileStatsRow,
  type ProfileUpdateFields,
  type ProfileUserRow,
} from "./profile.repository.js";

const POLISH_MONTHS = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paź",
  "lis",
  "gru",
];

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const formatRelativeDate = (date: Date, now = new Date()): string => {
  const today = startOfDay(now);
  const target = startOfDay(date);
  const diffDays = Math.round(
    (today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (diffDays === 0) return "Dziś";
  if (diffDays === 1) return "Wczoraj";

  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getDate()} ${POLISH_MONTHS[date.getMonth()]}`;
  }

  return date.toLocaleDateString("pl-PL");
};

const formatTimeLabel = (date: Date): string =>
  date.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const formatDuration = (durationSec: number): string => {
  const totalMinutes = Math.max(1, Math.round(durationSec / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} godz`;
  }
  return `${hours} godz ${minutes} min`;
};

const formatVolume = (volumeKg: number): string => {
  const rounded = Math.round(volumeKg);
  if (rounded <= 0) return "—";
  return `${rounded.toLocaleString("pl-PL")} kg`;
};

const formatExerciseDetail = (count: number): string => {
  if (count === 1) return "1 ćwiczenie";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ćwiczenia`;
  }
  return `${count} ćwiczeń`;
};

const formatFollowingUser = (row: FollowingUserRow) => ({
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

const formatActivity = (row: ProfileActivityRow) => ({
  id: row.id,
  kind: "strength" as const,
  title: row.plan_name,
  date: formatRelativeDate(row.started_at),
  duration: formatDuration(row.duration_sec),
  detail: formatExerciseDetail(row.exercises_count),
  timeLabel: formatTimeLabel(row.started_at),
  stats: [
    { label: "Czas", value: formatDuration(row.duration_sec) },
    { label: "Ćwiczenia", value: formatExerciseDetail(row.exercises_count) },
    { label: "Objętość", value: formatVolume(row.volume_kg) },
  ],
  kudosCount: 0,
  commentCount: 0,
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
    console.warn("[profile] failed to remove avatar file", avatarUrl, e);
  }
};

const removeUploadedFile = async (diskPath: string): Promise<void> => {
  try {
    await safeUnlink(diskPath);
  } catch (e: unknown) {
    console.warn("[profile] failed to remove uploaded file", diskPath, e);
  }
};

const ensureUserExists = async (userId: string): Promise<void> => {
  const exists = await profileRepository.userExists(userId);
  if (!exists) {
    throw new AppError(404, "user_not_found");
  }
};

const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "23503";

export const profileService = {
  getOwnProfile: async (userId: string) => {
    const [row, stats] = await Promise.all([
      profileRepository.findProfileById(userId),
      profileRepository.findStatsByUserId(userId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return formatProfile(row, stats, true);
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
      profileRepository.updateProfile(userId, fields),
      profileRepository.findStatsByUserId(userId),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return formatProfile(row, stats, true);
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
    return formatProfile(row, stats, true);
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
    return formatProfile(row, stats, true);
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

  getRecentActivities: async (userId: string, limit: number) => {
    const rows = await profileRepository.listRecentActivities(userId, limit);
    return rows.map(formatActivity);
  },

  getUserActivities: async (
    _viewerId: string,
    targetUserId: string,
    limit: number,
  ) => {
    const [row, rows] = await Promise.all([
      profileRepository.findProfileById(targetUserId),
      profileRepository.listRecentActivities(targetUserId, limit),
    ]);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    return rows.map(formatActivity);
  },
};
