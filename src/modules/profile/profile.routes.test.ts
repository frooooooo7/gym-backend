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

/** `/profile/me*` rows also carry the private details. */
const ownProfileRow = {
  ...profileRow,
  birth_date: null,
  gender: null,
  height_cm: null,
  weight_kg: null,
  training_goal: null,
  experience_level: null,
  weekly_training_days: null,
  onboarding_completed: true,
};

const emptyDetails = {
  birthDate: null,
  gender: null,
  heightCm: null,
  weightKg: null,
  trainingGoal: null,
  experienceLevel: null,
  weeklyTrainingDays: null,
};

/** `YYYY-MM-01` of the current month [years] ago (UTC) — date-independent ages. */
const isoYearsAgo = (years: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
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
      "FROM users": { rows: [ownProfileRow] },
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
      onboardingCompleted: true,
      details: emptyDetails,
    });
    const sql = String(findCall("FROM users")?.[0]);
    expect(sql).toContain("to_char(users.birth_date, 'YYYY-MM-DD') AS birth_date");
    expect(sql).toContain("users.weight_kg::float8 AS weight_kg");
  });

  it("GET /profile/me returns filled details", async () => {
    whenSqlContains({
      "FROM users": {
        rows: [
          {
            ...ownProfileRow,
            birth_date: "1998-03-15",
            gender: "female",
            height_cm: 168,
            weight_kg: 61.5,
            training_goal: "strength",
            experience_level: "intermediate",
            weekly_training_days: 4,
            onboarding_completed: false,
          },
        ],
      },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app).get("/profile/me").set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(false);
    expect(res.body.details).toEqual({
      birthDate: "1998-03-15",
      gender: "female",
      heightCm: 168,
      weightKg: 61.5,
      trainingGoal: "strength",
      experienceLevel: "intermediate",
      weeklyTrainingDays: 4,
    });
  });

  it("PATCH /profile/me updates bio", async () => {
    whenSqlContains({
      "UPDATE users": {
        rows: [{ ...ownProfileRow, bio: "Nowy opis" }],
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
    expect(res.body.details).toEqual(emptyDetails);

    const update = findCall("UPDATE users");
    expect(String(update?.[0])).toContain("bio = $2");
    expect(String(update?.[0])).not.toContain("first_name =");
    expect(String(update?.[0])).not.toContain("handle =");
    expect(update?.[1]).toEqual([USER_ID, "Nowy opis"]);
  });

  it("PATCH /profile/me stores empty bio as null", async () => {
    whenSqlContains({
      "UPDATE users": { rows: [{ ...ownProfileRow, bio: null }] },
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
        rows: [{ ...ownProfileRow, first_name: "Janusz", last_name: "Nowak" }],
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
    [{ nickname: "new.handle" }, "no_fields_to_update"],
    [{ handle: "ab" }, "invalid_handle"],
    [{ handle: "x".repeat(31) }, "invalid_handle"],
    [{ handle: "_jan" }, "invalid_handle"],
    [{ handle: "jan kowalski" }, "invalid_handle"],
    [{ handle: "jan!" }, "invalid_handle"],
    [{ handle: null }, "invalid_handle"],
    [{ birthDate: isoYearsAgo(10) }, "invalid_birth_date"],
    [{ birthDate: isoYearsAgo(101) }, "invalid_birth_date"],
    [{ birthDate: "2001-02-30" }, "invalid_birth_date"],
    [{ birthDate: "15.03.1998" }, "invalid_birth_date"],
    [{ birthDate: 19980315 }, "invalid_birth_date"],
    [{ gender: "unknown" }, "invalid_gender"],
    [{ heightCm: 99 }, "invalid_height"],
    [{ heightCm: 251 }, "invalid_height"],
    [{ heightCm: 180.5 }, "invalid_height"],
    [{ heightCm: "180" }, "invalid_height"],
    [{ weightKg: 29.9 }, "invalid_weight"],
    [{ weightKg: 300.1 }, "invalid_weight"],
    [{ weightKg: "80" }, "invalid_weight"],
    [{ trainingGoal: "cardio" }, "invalid_training_goal"],
    [{ experienceLevel: "pro" }, "invalid_experience_level"],
    [{ weeklyTrainingDays: 0 }, "invalid_weekly_training_days"],
    [{ weeklyTrainingDays: 8 }, "invalid_weekly_training_days"],
    [{ weeklyTrainingDays: 2.5 }, "invalid_weekly_training_days"],
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

  it("PATCH /profile/me stores handle and details, normalized", async () => {
    const birthDate = isoYearsAgo(28);
    whenSqlContains({
      "UPDATE users": {
        rows: [
          {
            ...ownProfileRow,
            handle: "jan.silny",
            birth_date: birthDate,
            gender: "male",
            height_cm: 182,
            weight_kg: 82.5,
            training_goal: "muscle",
            experience_level: "beginner",
            weekly_training_days: 3,
          },
        ],
      },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({
        handle: "  Jan.Silny ",
        birthDate,
        gender: "male",
        heightCm: 182,
        weightKg: 82.46,
        trainingGoal: "muscle",
        experienceLevel: "beginner",
        weeklyTrainingDays: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.handle).toBe("jan.silny");
    expect(res.body.details).toEqual({
      birthDate,
      gender: "male",
      heightCm: 182,
      weightKg: 82.5,
      trainingGoal: "muscle",
      experienceLevel: "beginner",
      weeklyTrainingDays: 3,
    });

    const update = findCall("UPDATE users");
    const sql = String(update?.[0]);
    expect(sql).toContain("handle = $2");
    expect(sql).toContain("birth_date = $3");
    expect(sql).toContain("weekly_training_days = $9");
    expect(sql).not.toContain("first_name =");
    expect(update?.[1]).toEqual([
      USER_ID,
      "jan.silny",
      birthDate,
      "male",
      182,
      82.5,
      "muscle",
      "beginner",
      3,
    ]);
  });

  it("PATCH /profile/me clears details sent as null", async () => {
    whenSqlContains({
      "UPDATE users": { rows: [ownProfileRow] },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ weightKg: null, gender: null });

    expect(res.status).toBe(200);
    const update = findCall("UPDATE users");
    expect(String(update?.[0])).toContain("gender = $2");
    expect(String(update?.[0])).toContain("weight_kg = $3");
    expect(update?.[1]).toEqual([USER_ID, null, null]);
  });

  it("PATCH /profile/me returns 409 handle_taken on a duplicate handle", async () => {
    mockQuery.mockImplementation((sql: string) =>
      String(sql).includes("UPDATE users")
        ? Promise.reject(
            Object.assign(new Error("duplicate key"), {
              code: "23505",
              constraint: "users_handle_unique_idx",
            }),
          )
        : Promise.resolve({ rows: [statsRow], rowCount: 1 }),
    );

    const res = await request(app)
      .patch("/profile/me")
      .set(authHeaders())
      .send({ handle: "anna.nowak" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("handle_taken");
  });

  it("POST /profile/me/onboarding/complete marks onboarding done", async () => {
    whenSqlContains({
      "UPDATE users": { rows: [ownProfileRow] },
      following_count: { rows: [statsRow] },
    });

    const res = await request(app)
      .post("/profile/me/onboarding/complete")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: USER_ID,
      onboardingCompleted: true,
      details: emptyDetails,
    });
    const update = findCall("UPDATE users");
    expect(String(update?.[0])).toContain(
      "onboarding_completed_at = COALESCE(onboarding_completed_at, now())",
    );
    expect(update?.[1]).toEqual([USER_ID]);
  });

  it("POST /profile/me/onboarding/complete returns 404 when user missing", async () => {
    whenSqlContains({ following_count: { rows: [statsRow] } });

    const res = await request(app)
      .post("/profile/me/onboarding/complete")
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });

  it("POST /profile/me/onboarding/complete returns 401 without auth", async () => {
    const res = await request(app).post("/profile/me/onboarding/complete");
    expect(res.status).toBe(401);
  });

  it("GET /users/:userId/profile never exposes private details", async () => {
    whenSqlContains({
      "FROM users": {
        rows: [
          {
            ...ownProfileRow,
            id: OTHER_USER_ID,
            birth_date: "1990-01-01",
            weight_kg: 90,
          },
        ],
      },
      following_count: { rows: [statsRow] },
      "AS is_followed_by": {
        rows: [{ is_following: false, is_followed_by: false }],
      },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/profile`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("details");
    expect(res.body).not.toHaveProperty("onboardingCompleted");
    expect(String(findCall("FROM users")?.[0])).not.toContain("birth_date");
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
