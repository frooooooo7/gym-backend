import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockPool, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery };
  const mockGetPool = vi.fn(
    (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
  );
  return { mockQuery, mockPool, mockGetPool };
});

vi.mock("../../db/pool.js", () => ({
  getPool: mockGetPool,
}));

const { createApp } = await import("../../app.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ANNA = "bbbbbbbb-0000-4000-8000-000000000002";
const OLA = "cccccccc-0000-4000-8000-000000000003";
const SESSION_ID = "f1000000-0000-4000-8000-000000000001";
const COPY_ID = "d1000000-0000-4000-8000-000000000001";
const PLAN_ID = "e1000000-0000-4000-8000-000000000001";

const authHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET, { expiresIn: "1h" })}`,
});

const app = createApp();
const BASE = "/api/v1";

const SQL = {
  state: "SELECT notifications_read_at, notification_settings",
  kudos: "JOIN session_kudos k",
  follows: "FROM user_follows f\n       WHERE f.following_id",
  copies: "FROM training_plans copy",
  records: "JOIN training_sessions ts ON ts.user_id = f.following_id",
  bests: "AS prev_one_rep_max_kg",
  users: "FROM users WHERE id = ANY",
  marks: "SELECT key, read_at, dismissed_at",
  prune:
    "DELETE FROM notification_marks\n       WHERE user_id = $1 AND COALESCE",
  markRead: "INSERT INTO notification_marks (user_id, key, read_at)\n",
  dismiss: "dismissed_at)",
  readAll: "UPDATE users SET notifications_read_at = now()",
  updateSettings: "SET notification_settings = $2::jsonb",
} as const;

type MockResult = { rows?: unknown[] };

const whenSqlContains = (patterns: Partial<Record<string, MockResult>>) => {
  mockQuery.mockImplementation((sql: string) => {
    for (const [pattern, result] of Object.entries(patterns)) {
      if (result && String(sql).includes(pattern)) {
        return Promise.resolve({ rows: result.rows ?? [], rowCount: 0 });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

const findCall = (pattern: string) =>
  mockQuery.mock.calls.find((call) => String(call[0]).includes(pattern));

const user = (id: string, name: string) => ({
  id,
  first_name: name,
  last_name: "Test",
  handle: name.toLowerCase(),
  avatar_url: null,
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeEach(() => {
  mockQuery.mockReset();
  mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
});

describe("GET /notifications", () => {
  it("merges kudos, followers, plan copies and records, newest first", async () => {
    whenSqlContains({
      [SQL.state]: {
        rows: [
          { notifications_read_at: minutesAgo(90), notification_settings: {} },
        ],
      },
      [SQL.kudos]: {
        rows: [
          {
            session_id: SESSION_ID,
            plan_name: "Push",
            at: minutesAgo(12),
            actor_count: 3,
            actor_ids: [ANNA, OLA],
          },
        ],
      },
      [SQL.follows]: {
        rows: [{ actor_id: OLA, at: minutesAgo(60), is_following: false }],
      },
      [SQL.copies]: {
        rows: [
          {
            copy_id: COPY_ID,
            actor_id: OLA,
            at: minutesAgo(180),
            plan_id: PLAN_ID,
            plan_name: "Góra A",
          },
        ],
      },
      [SQL.records]: {
        rows: [
          {
            session_id: SESSION_ID,
            actor_id: ANNA,
            at: minutesAgo(30),
            plan_name: "Legs",
          },
        ],
      },
      [SQL.bests]: {
        rows: [
          {
            session_id: SESSION_ID,
            exercise_name: "Martwy ciąg",
            best_weight_kg: 120,
            best_weight_reps: 3,
            best_one_rep_max_kg: null,
            best_one_rep_max_weight_kg: null,
            best_one_rep_max_reps: null,
            best_bodyweight_reps: null,
            has_previous: true,
            prev_weight_kg: 115,
            prev_one_rep_max_kg: null,
            prev_bodyweight_reps: null,
          },
        ],
      },
      [SQL.users]: { rows: [user(ANNA, "Anna"), user(OLA, "Ola")] },
    });

    const res = await request(app)
      .get(`${BASE}/notifications`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      `kudos:${SESSION_ID}`,
      `record:${SESSION_ID}`,
      `follow:${OLA}`,
      `plan_copy:${COPY_ID}`,
    ]);
    const [kudos, record, follow, copy] = res.body.items;
    expect(kudos).toMatchObject({
      type: "kudos",
      read: false,
      actorCount: 3,
      session: { id: SESSION_ID, title: "Push" },
    });
    expect(kudos.actors.map((a: { handle: string }) => a.handle)).toEqual([
      "anna",
      "ola",
    ]);
    expect(record.record).toMatchObject({
      exerciseName: "Martwy ciąg",
      weightKg: 120,
      reps: 3,
    });
    expect(follow).toMatchObject({ isFollowing: false, read: false });
    // Older than "mark all read".
    expect(copy).toMatchObject({
      read: true,
      plan: { id: PLAN_ID, name: "Góra A" },
    });
    expect(res.body.unreadCount).toBe(3);
  });

  it("hides dismissed items until new activity arrives", async () => {
    whenSqlContains({
      [SQL.state]: {
        rows: [{ notifications_read_at: null, notification_settings: {} }],
      },
      [SQL.follows]: {
        rows: [{ actor_id: OLA, at: minutesAgo(60), is_following: true }],
      },
      [SQL.kudos]: {
        rows: [
          {
            session_id: SESSION_ID,
            plan_name: "Push",
            at: minutesAgo(5),
            actor_count: 2,
            actor_ids: [ANNA],
          },
        ],
      },
      [SQL.marks]: {
        rows: [
          {
            key: `follow:${OLA}`,
            read_at: minutesAgo(30),
            dismissed_at: minutesAgo(30),
          },
          // Dismissed before the newest kudo — shown again.
          {
            key: `kudos:${SESSION_ID}`,
            read_at: minutesAgo(10),
            dismissed_at: minutesAgo(10),
          },
        ],
      },
      [SQL.users]: { rows: [user(ANNA, "Anna"), user(OLA, "Ola")] },
    });

    const res = await request(app)
      .get(`${BASE}/notifications`)
      .set(authHeaders());

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      `kudos:${SESSION_ID}`,
    ]);
    expect(res.body.items[0].read).toBe(false);
  });

  it("skips kinds switched off in settings", async () => {
    whenSqlContains({
      [SQL.state]: {
        rows: [
          {
            notifications_read_at: null,
            notification_settings: { kudos: false, records: false },
          },
        ],
      },
    });

    await request(app).get(`${BASE}/notifications`).set(authHeaders());

    expect(findCall(SQL.kudos)).toBeUndefined();
    expect(findCall(SQL.records)).toBeUndefined();
    expect(findCall(SQL.follows)).toBeDefined();
    expect(findCall(SQL.copies)).toBeDefined();
  });

  it("requires auth", async () => {
    const res = await request(app).get(`${BASE}/notifications`);
    expect(res.status).toBe(401);
  });
});

describe("GET /notifications/unread-count", () => {
  it("only looks at activity newer than mark-all-read", async () => {
    const readAt = minutesAgo(15);
    whenSqlContains({
      [SQL.state]: {
        rows: [{ notifications_read_at: readAt, notification_settings: {} }],
      },
      [SQL.follows]: {
        rows: [{ actor_id: OLA, at: minutesAgo(5), is_following: false }],
      },
    });

    const res = await request(app)
      .get(`${BASE}/notifications/unread-count`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1 });
    expect(findCall(SQL.follows)?.[1]).toEqual([USER_ID, readAt]);
    expect(findCall(SQL.users)).toBeUndefined();
  });
});

describe("marking and dismissing", () => {
  it("marks one item read", async () => {
    whenSqlContains({});
    const res = await request(app)
      .post(`${BASE}/notifications/kudos:${SESSION_ID}/read`)
      .set(authHeaders());
    expect(res.status).toBe(204);
    expect(findCall(SQL.markRead)?.[1]).toEqual([
      USER_ID,
      `kudos:${SESSION_ID}`,
    ]);
  });

  it("dismisses one item", async () => {
    whenSqlContains({});
    const res = await request(app)
      .delete(`${BASE}/notifications/follow:${OLA}`)
      .set(authHeaders());
    expect(res.status).toBe(204);
    expect(findCall(SQL.dismiss)?.[1]).toEqual([USER_ID, `follow:${OLA}`]);
  });

  it("rejects unknown ids", async () => {
    const res = await request(app)
      .delete(`${BASE}/notifications/comment:${OLA}`)
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("marks everything read", async () => {
    whenSqlContains({});
    const res = await request(app)
      .post(`${BASE}/notifications/read-all`)
      .set(authHeaders());
    expect(res.status).toBe(204);
    expect(findCall(SQL.readAll)).toBeDefined();
  });
});

describe("notification settings", () => {
  it("fills in defaults", async () => {
    whenSqlContains({
      [SQL.state]: {
        rows: [{ notifications_read_at: null, notification_settings: {} }],
      },
    });
    const res = await request(app)
      .get(`${BASE}/notifications/settings`)
      .set(authHeaders());
    expect(res.body).toEqual({
      kudos: true,
      follows: true,
      planCopies: true,
      records: true,
      quietHours: { enabled: false, from: "22:00", to: "07:00" },
    });
  });

  it("merges a partial update", async () => {
    whenSqlContains({
      [SQL.state]: {
        rows: [
          {
            notifications_read_at: null,
            notification_settings: { quietHours: { from: "23:00" } },
          },
        ],
      },
      [SQL.updateSettings]: {
        rows: [
          {
            notification_settings: {
              kudos: false,
              quietHours: { enabled: true, from: "23:00", to: "07:00" },
            },
          },
        ],
      },
    });
    const res = await request(app)
      .patch(`${BASE}/notifications/settings`)
      .set(authHeaders())
      .send({ kudos: false, quietHours: { enabled: true } });

    expect(res.status).toBe(200);
    const saved = JSON.parse(String(findCall(SQL.updateSettings)?.[1]?.[1]));
    expect(saved).toMatchObject({
      kudos: false,
      follows: true,
      quietHours: { enabled: true, from: "23:00", to: "07:00" },
    });
    expect(res.body.kudos).toBe(false);
  });

  it("rejects a malformed time", async () => {
    const res = await request(app)
      .patch(`${BASE}/notifications/settings`)
      .set(authHeaders())
      .send({ quietHours: { from: "25:00" } });
    expect(res.status).toBe(400);
  });
});
