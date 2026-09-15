import fs from "node:fs/promises";
import path from "node:path";
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

const authHeaders = (sub = USER_ID) => ({
  Authorization: `Bearer ${makeToken(sub)}`,
});

const app = createApp();

const AVATARS_DIR = path.join(process.cwd(), "uploads", "avatars");

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
  is_following: true,
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

const findCall = (pattern: string) =>
  mockQuery.mock.calls.find((call) => String(call[0]).includes(pattern));

const resetDbMocks = () => {
  mockQuery.mockReset();
  mockGetPool.mockReset();
  mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
};

describe("profile routes", () => {
  beforeEach(resetDbMocks);

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
      isFollowing: false,
      isFollowedBy: false,
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
    expect(res.body.isFollowing).toBe(false);
    expect(res.body.isFollowedBy).toBe(false);

    const update = findCall("UPDATE users");
    expect(String(update?.[0])).toContain("bio = $2");
    expect(String(update?.[0])).not.toContain("first_name =");
    expect(String(update?.[0])).not.toContain("handle =");
    expect(update?.[1]).toEqual([USER_ID, "Nowy opis"]);
  });

  it("PATCH /profile/me stores empty bio as null", async () => {
    whenSqlContains({
      "UPDATE users": { rows: [{ ...profileRow, bio: null }] },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ bio: "   " });

    expect(res.status).toBe(200);
    expect(res.body.bio).toBeNull();
    expect(findCall("UPDATE users")?.[1]).toEqual([USER_ID, null]);
  });

  it("PATCH /profile/me returns 400 for bio over 120 chars", async () => {
    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ bio: "x".repeat(121) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bio_too_long");
  });

  it("PATCH /profile/me updates trimmed first and last name without touching handle", async () => {
    whenSqlContains({
      "UPDATE users": {
        rows: [{ ...profileRow, first_name: "Janusz", last_name: "Nowak" }],
      },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ firstName: "  Janusz ", lastName: "Nowak" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      firstName: "Janusz",
      lastName: "Nowak",
      handle: "jan.kowalski_a1b2c3",
      isOwnProfile: true,
    });

    const update = findCall("UPDATE users");
    const sql = String(update?.[0]);
    expect(sql).toContain("first_name = $2");
    expect(sql).toContain("last_name = $3");
    expect(sql).not.toContain("bio =");
    expect(sql).not.toContain("handle =");
    expect(update?.[1]).toEqual([USER_ID, "Janusz", "Nowak"]);
  });

  it.each([
    [{ firstName: "" }, "invalid_first_name"],
    [{ firstName: "   " }, "invalid_first_name"],
    [{ firstName: "x".repeat(51) }, "invalid_first_name"],
    [{ firstName: 123 }, "invalid_first_name"],
    [{ firstName: null }, "invalid_first_name"],
    [{ lastName: "" }, "invalid_last_name"],
    [{ lastName: "y".repeat(51) }, "invalid_last_name"],
    [{ lastName: false }, "invalid_last_name"],
    [{}, "no_fields_to_update"],
    [{ handle: "new.handle" }, "no_fields_to_update"],
  ])("PATCH /profile/me with %j returns 400 %s", async (body, code) => {
    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("PATCH /profile/me returns 400 no_fields_to_update without a body", async () => {
    const res = await request(app).patch("/profile/me").set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_fields_to_update");
  });

  it("GET /users/:userId/profile returns other user profile", async () => {
    whenSqlContains({
      "FROM users": { rows: [{ ...profileRow, id: OTHER_USER_ID, bio: null }] },
      following_count: {
        rows: [{ following_count: 1, followers_count: 2, workouts_count: 4 }],
      },
      "AS is_followed_by": {
        rows: [{ is_following: true, is_followed_by: false }],
      },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/profile`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: OTHER_USER_ID,
      isOwnProfile: false,
      isFollowing: true,
      isFollowedBy: false,
    });
    expect(findCall("AS is_followed_by")?.[1]).toEqual([
      USER_ID,
      OTHER_USER_ID,
    ]);
  });

  it("GET /users/:userId/profile returns isFollowedBy when target follows viewer", async () => {
    whenSqlContains({
      "FROM users": { rows: [{ ...profileRow, id: OTHER_USER_ID }] },
      following_count: { rows: [statsRow] },
      "AS is_followed_by": {
        rows: [{ is_following: false, is_followed_by: true }],
      },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/profile`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.isFollowing).toBe(false);
    expect(res.body.isFollowedBy).toBe(true);
  });

  it("GET /users/:userId/profile for the viewer has both flags false", async () => {
    whenSqlContains({
      "FROM users": { rows: [profileRow] },
      following_count: { rows: [statsRow] },
      "AS is_followed_by": {
        rows: [{ is_following: true, is_followed_by: true }],
      },
    });

    const res = await request(app)
      .get(`/users/${USER_ID}/profile`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      isOwnProfile: true,
      isFollowing: false,
      isFollowedBy: false,
    });
    expect(findCall("AS is_followed_by")).toBeUndefined();
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
        isFollowing: true,
      },
    ]);
    const call = findCall("uf.follower_id = $1");
    expect(String(call?.[0])).toContain("EXISTS");
    expect(call?.[1]).toEqual([USER_ID, USER_ID, 10, 0]);
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

  it("GET /profile/activities only lists sessions shared to profile", async () => {
    whenSqlContains({
      "FROM training_sessions ts": { rows: [activityRow] },
    });

    await request(app).get("/profile/activities?limit=5").set(authHeaders());

    const activitiesSql = mockQuery.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("FROM training_sessions ts"));
    expect(activitiesSql).toContain("ts.shared_to_profile = true");
  });

  it("GET /users/search returns matching users with isFollowing", async () => {
    whenSqlContains({
      "lower(u.handle) LIKE $2": {
        rows: [
          followingRow,
          {
            ...followingRow,
            id: "cccccccc-0000-0000-0000-000000000003",
            handle: "anna.zielinska_aaaaaa",
            is_following: false,
          },
        ],
      },
    });

    const res = await request(app)
      .get("/users/search?q=anna")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].handle).toBe("anna.nowak_d4e5f6");
    expect(res.body[0].isFollowing).toBe(true);
    expect(res.body[1].isFollowing).toBe(false);
    expect(String(findCall("lower(u.handle) LIKE $2")?.[0])).toContain(
      "vf.follower_id = $1",
    );
  });

  it("GET /users/:userId/activities returns user activities", async () => {
    whenSqlContains({
      "FROM users": { rows: [{ ...profileRow, id: OTHER_USER_ID }] },
      "FROM training_sessions ts": { rows: [activityRow] },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/activities?limit=3`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(SESSION_ID);
  });

  it("GET /users/:userId/activities returns 401 without auth", async () => {
    const res = await request(app).get(
      `/users/${OTHER_USER_ID}/activities?limit=3`,
    );
    expect(res.status).toBe(401);
  });

  it("GET /users/:userId/activities returns 400 for invalid userId", async () => {
    const res = await request(app)
      .get("/users/not-a-uuid/activities?limit=3")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("GET /users/:userId/activities returns 404 when user missing", async () => {
    whenSqlContains({
      "FROM users": { rows: [] },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/activities?limit=3`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "user_not_found" });
  });

  it("GET /profile/followers returns user list", async () => {
    whenSqlContains({
      "uf.following_id = $1": { rows: [{ ...followingRow, is_following: false }] },
    });

    const res = await request(app)
      .get("/profile/followers?limit=10&offset=0")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: OTHER_USER_ID,
        firstName: "Anna",
        lastName: "Nowak",
        handle: "anna.nowak_d4e5f6",
        avatarUrl: null,
        isFollowing: false,
      },
    ]);
  });

  it("GET /users/:userId/profile returns 401 without auth", async () => {
    const res = await request(app).get(`/users/${OTHER_USER_ID}/profile`);
    expect(res.status).toBe(401);
  });

  it("GET /users/:userId/profile returns 400 for invalid userId", async () => {
    const res = await request(app)
      .get("/users/not-a-uuid/profile")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("GET /users/:userId/profile returns 404 when user missing", async () => {
    whenSqlContains({
      "FROM users": { rows: [] },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/profile`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "user_not_found" });
  });

  it("GET /profile/following returns 400 for invalid limit/offset values", async () => {
    const res = await request(app)
      .get("/profile/following?limit=-5")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("GET /profile/followers returns 400 for invalid limit/offset values", async () => {
    const res = await request(app)
      .get("/profile/followers?limit=abc")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("GET /users/search returns 400 for invalid limit query", async () => {
    const res = await request(app)
      .get("/users/search?limit=101")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });
});

describe("user following/followers lists", () => {
  beforeEach(resetDbMocks);

  it("GET /users/:userId/following lists the target's followings from the viewer's perspective", async () => {
    whenSqlContains({
      "SELECT 1 FROM users": { rows: [{ "?column?": 1 }] },
      "uf.follower_id = $1": {
        rows: [
          { ...followingRow, id: USER_ID, handle: "me", is_following: false },
        ],
      },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/following?limit=10&offset=5`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: USER_ID,
        firstName: "Anna",
        lastName: "Nowak",
        handle: "me",
        avatarUrl: null,
        isFollowing: false,
      },
    ]);
    expect(findCall("uf.follower_id = $1")?.[1]).toEqual([
      OTHER_USER_ID,
      USER_ID,
      10,
      5,
    ]);
  });

  it("GET /users/:userId/followers lists the target's followers with defaults", async () => {
    whenSqlContains({
      "SELECT 1 FROM users": { rows: [{ "?column?": 1 }] },
      "uf.following_id = $1": { rows: [followingRow] },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/followers`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].isFollowing).toBe(true);
    expect(findCall("uf.following_id = $1")?.[1]).toEqual([
      OTHER_USER_ID,
      USER_ID,
      20,
      0,
    ]);
  });

  it.each(["following", "followers"])(
    "GET /users/:userId/%s returns 404 when user missing",
    async (list) => {
      whenSqlContains({});
      const res = await request(app)
        .get(`/users/${OTHER_USER_ID}/${list}`)
        .set(authHeaders());
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("user_not_found");
    },
  );

  it.each(["following", "followers"])(
    "GET /users/:userId/%s validates params and query",
    async (list) => {
      const badId = await request(app)
        .get(`/users/not-a-uuid/${list}`)
        .set(authHeaders());
      expect(badId.status).toBe(400);
      expect(badId.body.error).toBe("invalid_uuid");

      const badLimit = await request(app)
        .get(`/users/${OTHER_USER_ID}/${list}?limit=101`)
        .set(authHeaders());
      expect(badLimit.status).toBe(400);

      const badOffset = await request(app)
        .get(`/users/${OTHER_USER_ID}/${list}?offset=-1`)
        .set(authHeaders());
      expect(badOffset.status).toBe(400);

      const noAuth = await request(app).get(`/users/${OTHER_USER_ID}/${list}`);
      expect(noAuth.status).toBe(401);
    },
  );
});

describe("follow / unfollow", () => {
  beforeEach(resetDbMocks);

  it("POST /users/:userId/follow follows the user and returns followers count", async () => {
    whenSqlContains({
      "SELECT 1 FROM users": { rows: [{ "?column?": 1 }] },
      followers_count: { rows: [{ followers_count: 6 }] },
    });

    const res = await request(app)
      .post(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isFollowing: true, followersCount: 6 });

    const insert = findCall("INSERT INTO user_follows");
    expect(String(insert?.[0])).toContain("ON CONFLICT DO NOTHING");
    expect(insert?.[1]).toEqual([USER_ID, OTHER_USER_ID]);
    expect(findCall("followers_count")?.[1]).toEqual([OTHER_USER_ID]);
  });

  it("POST /users/:userId/follow is idempotent", async () => {
    whenSqlContains({
      "SELECT 1 FROM users": { rows: [{ "?column?": 1 }] },
      followers_count: { rows: [{ followers_count: 6 }] },
    });

    const first = await request(app)
      .post(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());
    const second = await request(app)
      .post(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ isFollowing: true, followersCount: 6 });
  });

  it("POST /users/:userId/follow returns 400 when following self", async () => {
    const res = await request(app)
      .post(`/users/${USER_ID}/follow`)
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cannot_follow_self");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /users/:userId/follow returns 404 when target missing", async () => {
    whenSqlContains({});

    const res = await request(app)
      .post(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
    expect(findCall("INSERT INTO user_follows")).toBeUndefined();
  });

  it("POST /users/:userId/follow maps FK violation (user deleted mid-request) to 404", async () => {
    mockQuery.mockImplementation((sql: string) => {
      const sqlStr = String(sql);
      if (sqlStr.includes("SELECT 1 FROM users")) {
        return Promise.resolve({ rows: [{ "?column?": 1 }], rowCount: 1 });
      }
      if (sqlStr.includes("INSERT INTO user_follows")) {
        const error = new Error("insert violates foreign key constraint");
        (error as NodeJS.ErrnoException).code = "23503";
        return Promise.reject(error);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .post(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });

  it("POST /users/:userId/follow returns 400 for invalid userId", async () => {
    const res = await request(app)
      .post("/users/not-a-uuid/follow")
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_uuid");
  });

  it("POST /users/:userId/follow returns 401 without auth", async () => {
    const res = await request(app).post(`/users/${OTHER_USER_ID}/follow`);
    expect(res.status).toBe(401);
  });

  it("DELETE /users/:userId/follow unfollows and returns followers count", async () => {
    whenSqlContains({
      "SELECT 1 FROM users": { rows: [{ "?column?": 1 }] },
      followers_count: { rows: [{ followers_count: 4 }] },
    });

    const res = await request(app)
      .delete(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isFollowing: false, followersCount: 4 });
    expect(findCall("DELETE FROM user_follows")?.[1]).toEqual([
      USER_ID,
      OTHER_USER_ID,
    ]);
  });

  it("DELETE /users/:userId/follow returns 404 when target missing", async () => {
    whenSqlContains({});

    const res = await request(app)
      .delete(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
    expect(findCall("DELETE FROM user_follows")).toBeUndefined();
  });

  it("DELETE /users/:userId/follow returns 400 for invalid userId", async () => {
    const res = await request(app)
      .delete("/users/not-a-uuid/follow")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("follow/unfollow is rate limited per user (60/min)", async () => {
    // Dedicated user id so the limiter bucket does not affect other tests.
    const limitedUser = "dddddddd-0000-0000-0000-000000000004";
    whenSqlContains({
      "SELECT 1 FROM users": { rows: [{ "?column?": 1 }] },
      followers_count: { rows: [{ followers_count: 1 }] },
    });

    for (let i = 0; i < 60; i += 1) {
      const res = await request(app)
        .post(`/users/${OTHER_USER_ID}/follow`)
        .set(authHeaders(limitedUser));
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .delete(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders(limitedUser));
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("too_many_requests");

    const otherUser = await request(app)
      .post(`/users/${OTHER_USER_ID}/follow`)
      .set(authHeaders("eeeeeeee-0000-0000-0000-000000000005"));
    expect(otherUser.status).toBe(200);
  });
});

describe("avatar", () => {
  beforeEach(resetDbMocks);

  const listAvatarFiles = async () => {
    await fs.mkdir(AVATARS_DIR, { recursive: true });
    return fs.readdir(AVATARS_DIR);
  };

  const fileExists = async (p: string) =>
    fs.stat(p).then(
      () => true,
      () => false,
    );

  /** Echo the uploaded avatar_url back from the UPDATE like Postgres would. */
  const mockAvatarUpdate = (previousAvatarUrl: string | null) => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const sqlStr = String(sql);
      if (sqlStr.includes("UPDATE users")) {
        return Promise.resolve({
          rows: [
            {
              ...profileRow,
              avatar_url: params?.[1] ?? null,
              previous_avatar_url: previousAvatarUrl,
            },
          ],
          rowCount: 1,
        });
      }
      if (sqlStr.includes("following_count")) {
        return Promise.resolve({ rows: [statsRow], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  };

  it("POST /profile/me/avatar stores the file, returns profile and removes the previous avatar", async () => {
    await listAvatarFiles();
    const previousName = `test-previous-${Date.now()}.png`;
    const previousPath = path.join(AVATARS_DIR, previousName);
    await fs.writeFile(previousPath, "old");
    mockAvatarUpdate(`/uploads/avatars/${previousName}`);

    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("avatar", Buffer.from("fake png bytes"), {
        filename: "me.PNG",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(
      /^\/uploads\/avatars\/[0-9a-f-]{36}\.png$/,
    );
    expect(res.body).toMatchObject({
      id: USER_ID,
      isOwnProfile: true,
      isFollowing: false,
      isFollowedBy: false,
    });

    const storedPath = path.join(
      AVATARS_DIR,
      path.basename(res.body.avatarUrl as string),
    );
    try {
      expect(await fileExists(storedPath)).toBe(true);
      expect(await fileExists(previousPath)).toBe(false);

      const served = await request(app).get(res.body.avatarUrl as string);
      expect(served.status).toBe(200);
      expect(served.headers["cache-control"]).toContain("immutable");

      expect(findCall("UPDATE users")?.[1]).toEqual([
        USER_ID,
        res.body.avatarUrl,
      ]);
    } finally {
      await fs.rm(storedPath, { force: true });
      await fs.rm(previousPath, { force: true });
    }
  });

  it("POST /profile/me/avatar accepts application/octet-stream with an allowed extension", async () => {
    mockAvatarUpdate(null);

    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("avatar", Buffer.from("fake webp bytes"), {
        filename: "avatar.webp",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(/^\/uploads\/avatars\/.+\.webp$/);
    await fs.rm(path.join(AVATARS_DIR, path.basename(res.body.avatarUrl)), {
      force: true,
    });
  });

  it("POST /profile/me/avatar never deletes files outside the avatars directory", async () => {
    const exerciseDir = path.join(process.cwd(), "uploads", "exercise-images");
    await fs.mkdir(exerciseDir, { recursive: true });
    const exerciseFile = path.join(exerciseDir, `keep-${Date.now()}.png`);
    await fs.writeFile(exerciseFile, "keep");
    mockAvatarUpdate(`/uploads/exercise-images/${path.basename(exerciseFile)}`);

    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("avatar", Buffer.from("x"), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      });

    try {
      expect(res.status).toBe(200);
      expect(await fileExists(exerciseFile)).toBe(true);
    } finally {
      await fs.rm(exerciseFile, { force: true });
      if (res.body?.avatarUrl) {
        await fs.rm(path.join(AVATARS_DIR, path.basename(res.body.avatarUrl)), {
          force: true,
        });
      }
    }
  });

  it("POST /profile/me/avatar returns 400 invalid_file for disallowed type", async () => {
    const before = await listAvatarFiles();

    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("avatar", Buffer.from("GIF89a"), {
        filename: "avatar.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_file");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(await listAvatarFiles()).toEqual(before);
  });

  it("POST /profile/me/avatar returns 400 invalid_file for files over 5 MB", async () => {
    const before = await listAvatarFiles();

    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("avatar", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_file");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(await listAvatarFiles()).toEqual(before);
  });

  it("POST /profile/me/avatar returns 400 invalid_file for a wrong field name", async () => {
    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("image", Buffer.from("x"), {
        filename: "a.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_file");
  });

  it("POST /profile/me/avatar returns 400 missing_image without a file", async () => {
    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .field("foo", "bar");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_image");
  });

  it("POST /profile/me/avatar removes the uploaded file when user is missing", async () => {
    whenSqlContains({});
    const before = await listAvatarFiles();

    const res = await request(app)
      .post("/profile/me/avatar")
      .set(authHeaders())
      .attach("avatar", Buffer.from("fake image"), {
        filename: "avatar.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
    expect(await listAvatarFiles()).toEqual(before);
  });

  it("POST /profile/me/avatar returns 401 without auth", async () => {
    const res = await request(app).post("/profile/me/avatar");
    expect(res.status).toBe(401);
  });

  it("DELETE /profile/me/avatar clears avatarUrl and removes the file", async () => {
    await listAvatarFiles();
    const previousName = `test-delete-${Date.now()}.jpg`;
    const previousPath = path.join(AVATARS_DIR, previousName);
    await fs.writeFile(previousPath, "old");
    mockAvatarUpdate(`/uploads/avatars/${previousName}`);

    const res = await request(app)
      .delete("/profile/me/avatar")
      .set(authHeaders());

    try {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: USER_ID,
        avatarUrl: null,
        isOwnProfile: true,
      });
      expect(findCall("UPDATE users")?.[1]).toEqual([USER_ID, null]);
      expect(await fileExists(previousPath)).toBe(false);
    } finally {
      await fs.rm(previousPath, { force: true });
    }
  });

  it("DELETE /profile/me/avatar is idempotent when there is no avatar", async () => {
    mockAvatarUpdate(null);

    const res = await request(app)
      .delete("/profile/me/avatar")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
  });

  it("DELETE /profile/me/avatar still succeeds when the stored file is already gone", async () => {
    mockAvatarUpdate("/uploads/avatars/does-not-exist.png");

    const res = await request(app)
      .delete("/profile/me/avatar")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
  });

  it("DELETE /profile/me/avatar returns 404 when user missing", async () => {
    whenSqlContains({});

    const res = await request(app)
      .delete("/profile/me/avatar")
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });
});
