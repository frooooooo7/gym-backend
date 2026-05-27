import { AppError } from "../../common/errors.js";
import {
  deleteAvatarFile,
  deleteManagedAvatarFile,
} from "./profile.avatar-upload.js";
import {
  profileRepository,
  type FollowingUserRow,
  type ProfileActivityRow,
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
});

const formatProfile = (
  row: ProfileUserRow,
  stats: Awaited<ReturnType<typeof profileRepository.findStatsByUserId>>,
  isOwnProfile: boolean,
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

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "23505";

export const profileService = {
  getOwnProfile: async (userId: string) => {
    const row = await profileRepository.findProfileById(userId);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    const stats = await profileRepository.findStatsByUserId(userId);
    return formatProfile(row, stats, true);
  },

  getUserProfile: async (viewerId: string, targetUserId: string) => {
    const row = await profileRepository.findProfileById(targetUserId);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    const stats = await profileRepository.findStatsByUserId(targetUserId);
    return formatProfile(row, stats, viewerId === targetUserId);
  },

  updateProfile: async (userId: string, input: {
    bio?: string | null;
    firstName?: string;
    lastName?: string;
    handle?: string;
  }) => {
    if (input.handle !== undefined) {
      const taken = await profileRepository.isHandleTaken(input.handle, userId);
      if (taken) {
        throw new AppError(409, "handle_taken");
      }
    }

    let row: ProfileUserRow | undefined;
    try {
      row = await profileRepository.updateProfile(userId, input);
    } catch (error) {
      if (input.handle !== undefined && isUniqueViolation(error)) {
        throw new AppError(409, "handle_taken");
      }
      throw error;
    }
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    const stats = await profileRepository.findStatsByUserId(userId);
    return formatProfile(row, stats, true);
  },

  uploadAvatar: async (
    userId: string,
    publicPath: string,
    savedDiskPath: string,
  ) => {
    const existing = await profileRepository.findProfileById(userId);
    if (!existing) {
      await deleteAvatarFile(savedDiskPath);
      throw new AppError(404, "user_not_found");
    }

    let row: ProfileUserRow | undefined;
    try {
      row = await profileRepository.updateAvatarUrl(userId, publicPath);
    } catch (error) {
      await deleteAvatarFile(savedDiskPath);
      throw error;
    }
    if (!row) {
      await deleteAvatarFile(savedDiskPath);
      throw new AppError(404, "user_not_found");
    }

    deleteManagedAvatarFile(existing.avatar_url);

    const stats = await profileRepository.findStatsByUserId(userId);
    return formatProfile(row, stats, true);
  },

  getFollowing: async (userId: string, limit: number, offset: number) => {
    const rows = await profileRepository.listFollowing(userId, limit, offset);
    return rows.map(formatFollowingUser);
  },

  getFollowers: async (userId: string, limit: number, offset: number) => {
    const rows = await profileRepository.listFollowers(userId, limit, offset);
    return rows.map(formatFollowingUser);
  },

  searchUsers: async (viewerId: string, query: string, limit: number) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return profileRepository
        .searchUsers(viewerId, "", limit)
        .then((rows) => rows.map(formatFollowingUser));
    }
    const rows = await profileRepository.searchUsers(viewerId, trimmed, limit);
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
    const row = await profileRepository.findProfileById(targetUserId);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
    const rows = await profileRepository.listRecentActivities(targetUserId, limit);
    return rows.map(formatActivity);
  },
};
