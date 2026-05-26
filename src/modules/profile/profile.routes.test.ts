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
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_USER_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_EMAIL = "tester@gym.com";
const SESSION_ID = "f1000000-0000-4000-8000-000000000001";

const makeToken = (sub = USER_ID, email = USER_EMAIL) =>
  jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: "1h" });

const authHeaders = () => ({ Authorization: `Bearer ${makeToken()}` });

const app = createApp();

const profileRow = {
  id: USER_ID,
  first_name: "Jan",
  last_name: "Kowalski",
  handle: "jan.kowalski_a1b2c3",
  bio: "Trening 4x w tygodniu",
  avatar_url: null,
};

const statsRow = {
  following_count: 3,
  followers_count: 5,
  workouts_count: 12,
};

const followingRow = {
  id: OTHER_USER_ID,
  first_name: "Anna",
  last_name: "Nowak",
  handle: "anna.nowak_d4e5f6",
  avatar_url: null,
};

const activityRow = {
  id: SESSION_ID,
  started_at: new Date("2026-05-26T18:32:00Z"),
  finished_at: new Date("2026-05-26T19:30:00Z"),
  duration_sec: 3480,
  plan_name: "Push/Pull/Legs",
  exercises_count: 6,
  completed_sets_count: 18,
  volume_kg: 6450,
};

const whenSqlContains = (patterns: Record<string, { rows?: unknown[] }>) => {
  mockQuery.mockImplementation((sql: string) => {
    const sqlStr = String(sql);
    for (const [pattern, result] of Object.entries(patterns)) {
      if (sqlStr.includes(pattern)) {
        return Promise.resolve({
          rows: result.rows ?? [],
          rowCount: result.rows?.length ?? 0,
        });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

describe("profile routes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
  });

  it("GET /profile/me returns 401 without auth", async () => {
    const res = await request(app).get("/profile/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthorized" });
  });

  it("GET /profile/me returns own profile", async () => {
    whenSqlContains({
      "FROM users": { rows: [profileRow] },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app).get("/profile/me").set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: USER_ID,
      firstName: "Jan",
      lastName: "Kowalski",
      handle: "jan.kowalski_a1b2c3",
      bio: "Trening 4x w tygodniu",
      avatarUrl: null,
      stats: {
        followingCount: 3,
        followersCount: 5,
        workoutsCount: 12,
      },
      isOwnProfile: true,
    });
  });

  it("PATCH /profile/me updates bio", async () => {
    whenSqlContains({
      "UPDATE users": {
        rows: [{ ...profileRow, bio: "Nowy opis" }],
      },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ bio: "Nowy opis" });

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("Nowy opis");
    expect(res.body.isOwnProfile).toBe(true);
  });

  it("PATCH /profile/me returns 400 for bio over 120 chars", async () => {
    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ bio: "x".repeat(121) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bio_too_long");
  });

  it("GET /users/:userId/profile returns other user profile", async () => {
    whenSqlContains({
      "FROM users": { rows: [{ ...profileRow, id: OTHER_USER_ID, bio: null }] },
      following_count: {
        rows: [{ following_count: 1, followers_count: 2, workouts_count: 4 }],
      },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/profile`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: OTHER_USER_ID,
      isOwnProfile: false,
    });
  });

  it("GET /profile/following returns user list", async () => {
    whenSqlContains({
      "uf.follower_id = $1": { rows: [followingRow] },
    });

    const res = await request(app)
      .get("/profile/following?limit=10&offset=0")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: OTHER_USER_ID,
        firstName: "Anna",
        lastName: "Nowak",
        handle: "anna.nowak_d4e5f6",
        avatarUrl: null,
      },
    ]);
  });

  it("GET /profile/activities returns mapped training sessions", async () => {
    whenSqlContains({
      "FROM training_sessions ts": { rows: [activityRow] },
    });

    const res = await request(app)
      .get("/profile/activities?limit=5")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: SESSION_ID,
      kind: "strength",
      title: "Push/Pull/Legs",
      duration: "58 min",
      detail: "6 ćwiczeń",
      kudosCount: 0,
      commentCount: 0,
    });
    expect(res.body[0].stats).toEqual([
      { label: "Czas", value: "58 min" },
      { label: "Ćwiczenia", value: "6 ćwiczeń" },
      { label: "Objętość", value: "6450 kg" },
    ]);
  });

  it("GET /users/search returns matching users", async () => {
    whenSqlContains({
      "lower(handle) LIKE $2": { rows: [followingRow] },
    });

    const res = await request(app)
      .get("/users/search?q=anna")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].handle).toBe("anna.nowak_d4e5f6");
  });

  it("GET /users/:userId/activities returns user activities", async () => {
    whenSqlContains({
      "FROM training_sessions ts": { rows: [activityRow] },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/activities?limit=3`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(SESSION_ID);
  });
});
