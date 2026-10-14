import { AppError } from "../../common/errors.js";
import { feedRepository, type UserMiniRow } from "../feed/feed.repository.js";
import { personalRecordOf } from "../feed/feed.service.js";
import {
  notificationsRepository,
  type NotificationMarkRow,
} from "./notifications.repository.js";
import {
  notificationSettingsSchema,
  type NotificationSettings,
  type NotificationType,
  type UpdateNotificationSettingsBody,
} from "./notifications.schemas.js";

/** Older activity is not listed (and old marks are pruned). */
const WINDOW_DAYS = 30;
const MAX_ITEMS = 60;

const formatUserMini = (row: UserMiniRow) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  handle: row.handle,
  avatarUrl: row.avatar_url,
});

type UserMini = ReturnType<typeof formatUserMini>;

interface DraftItem {
  id: string;
  type: NotificationType;
  at: Date;
  actorIds: string[];
  actorCount: number;
  session?: { id: string; title: string };
  plan?: { id: string | null; name: string };
  record?: ReturnType<typeof personalRecordOf>;
  isFollowing?: boolean;
}

export const settingsOf = (stored: unknown): NotificationSettings =>
  notificationSettingsSchema.parse(stored ?? {});

const windowStart = () => new Date(Date.now() - WINDOW_DAYS * 86_400_000);

const later = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

/** Builds every enabled kind newer than [since]. */
const collect = async (
  userId: string,
  settings: NotificationSettings,
  since: Date,
): Promise<DraftItem[]> => {
  const [kudos, follows, copies, recordCandidates] = await Promise.all([
    settings.kudos ? notificationsRepository.listKudos(userId, since) : [],
    settings.follows
      ? notificationsRepository.listFollowers(userId, since)
      : [],
    settings.planCopies
      ? notificationsRepository.listPlanCopies(userId, since)
      : [],
    settings.records
      ? notificationsRepository.listRecordCandidates(userId, since)
      : [],
  ]);

  const items: DraftItem[] = [
    ...kudos.map((row) => ({
      id: `kudos:${row.session_id}`,
      type: "kudos" as const,
      at: row.at,
      actorIds: row.actor_ids,
      actorCount: row.actor_count,
      session: { id: row.session_id, title: row.plan_name },
    })),
    ...follows.map((row) => ({
      id: `follow:${row.actor_id}`,
      type: "follow" as const,
      at: row.at,
      actorIds: [row.actor_id],
      actorCount: 1,
      isFollowing: row.is_following,
    })),
    ...copies.map((row) => ({
      id: `plan_copy:${row.copy_id}`,
      type: "plan_copy" as const,
      at: row.at,
      actorIds: [row.actor_id],
      actorCount: 1,
      plan: { id: row.plan_id, name: row.plan_name },
    })),
  ];

  if (recordCandidates.length > 0) {
    const bests = await feedRepository.findExerciseBests(
      recordCandidates.map((row) => row.session_id),
    );
    const recordBySession = new Map<
      string,
      ReturnType<typeof personalRecordOf>
    >();
    for (const best of bests) {
      if (recordBySession.has(best.session_id)) continue;
      const record = personalRecordOf(best);
      if (record) recordBySession.set(best.session_id, record);
    }
    for (const row of recordCandidates) {
      const record = recordBySession.get(row.session_id);
      if (!record) continue;
      items.push({
        id: `record:${row.session_id}`,
        type: "record",
        at: row.at,
        actorIds: [row.actor_id],
        actorCount: 1,
        session: { id: row.session_id, title: row.plan_name },
        record,
      });
    }
  }
  return items;
};

const visible = (items: DraftItem[], marks: Map<string, NotificationMarkRow>) =>
  items.filter((item) => {
    const dismissed = marks.get(item.id)?.dismissed_at;
    return !dismissed || item.at > dismissed;
  });

const isUnread = (
  item: DraftItem,
  readAll: Date | null,
  marks: Map<string, NotificationMarkRow>,
) => {
  const readAt = later(readAll, marks.get(item.id)?.read_at ?? null);
  return readAt === null || item.at > readAt;
};

const loadState = async (userId: string) => {
  const state = await notificationsRepository.findState(userId);
  if (!state) throw new AppError(404, "user_not_found");
  return {
    readAll: state.notifications_read_at,
    settings: settingsOf(state.notification_settings),
  };
};

const marksById = async (userId: string) =>
  new Map(
    (await notificationsRepository.listMarks(userId)).map((m) => [m.key, m]),
  );

export const notificationsService = {
  list: async (userId: string) => {
    const { readAll, settings } = await loadState(userId);
    const since = windowStart();
    const [drafts, marks] = await Promise.all([
      collect(userId, settings, since),
      marksById(userId),
      notificationsRepository.pruneMarks(userId, since),
    ]);
    const items = visible(drafts, marks)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, MAX_ITEMS);

    const users = new Map(
      (
        await notificationsRepository.findUsers([
          ...new Set(items.flatMap((item) => item.actorIds)),
        ])
      ).map((row) => [row.id, formatUserMini(row)]),
    );

    let unreadCount = 0;
    const formatted = items.flatMap((item) => {
      const actors = item.actorIds
        .map((id) => users.get(id))
        .filter((user): user is UserMini => user !== undefined);
      // Konto autora zniknęło między zapytaniami.
      if (actors.length === 0) return [];
      const unread = isUnread(item, readAll, marks);
      if (unread) unreadCount++;
      return [
        {
          id: item.id,
          type: item.type,
          createdAt: item.at.toISOString(),
          read: !unread,
          actors,
          actorCount: item.actorCount,
          session: item.session ?? null,
          plan: item.plan ?? null,
          record: item.record ?? null,
          isFollowing: item.isFollowing ?? null,
        },
      ];
    });
    return { items: formatted, unreadCount };
  },

  /** Only activity newer than "mark all read" can be unread — cheap to poll. */
  unreadCount: async (userId: string) => {
    const { readAll, settings } = await loadState(userId);
    const since = later(readAll, windowStart())!;
    const [drafts, marks] = await Promise.all([
      collect(userId, settings, since),
      marksById(userId),
    ]);
    const count = visible(drafts, marks).filter((item) =>
      isUnread(item, readAll, marks),
    ).length;
    return { count: Math.min(count, MAX_ITEMS) };
  },

  markRead: async (userId: string, key: string) => {
    await notificationsRepository.markRead(userId, key);
  },

  markAllRead: async (userId: string) => {
    await notificationsRepository.markAllRead(userId);
  },

  dismiss: async (userId: string, key: string) => {
    await notificationsRepository.dismiss(userId, key);
  },

  getSettings: async (userId: string) => (await loadState(userId)).settings,

  updateSettings: async (
    userId: string,
    patch: UpdateNotificationSettingsBody,
  ) => {
    const { settings } = await loadState(userId);
    const next = settingsOf({
      ...settings,
      ...patch,
      quietHours: { ...settings.quietHours, ...patch.quietHours },
    });
    return settingsOf(
      await notificationsRepository.updateSettings(userId, next),
    );
  },
};
