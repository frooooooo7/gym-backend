import { AppError } from "../../common/errors.js";
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

  updateBio: async (userId: string, bio: string | null) => {
    const row = await profileRepository.updateBio(userId, bio);
    if (!row) {
      throw new AppError(404, "user_not_found");
    }
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
};
