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
const THIRD_USER_ID = "cccccccc-0000-0000-0000-000000000003";
const SESSION_ID = "f1000000-0000-4000-8000-000000000001";
const SESSION_ID_2 = "f1000000-0000-4000-8000-000000000002";
const SESSION_ID_3 = "f1000000-0000-4000-8000-000000000003";
const COMMENT_ID = "c1000000-0000-4000-8000-000000000001";
const COMMENT_ID_2 = "c1000000-0000-4000-8000-000000000002";

const makeToken = (sub = USER_ID) =>
  jwt.sign({ sub, email: "tester@gym.com" }, JWT_SECRET, { expiresIn: "1h" });

const authHeaders = (sub = USER_ID) => ({
  Authorization: `Bearer ${makeToken(sub)}`,
});

const app = createApp();

// ---- SQL markers (unique substrings of each repository query) ----
const SQL = {
  listFeed: "OR ts.user_id IN (",
  listUserPosts: "WHERE ts.user_id = $1",
  userExists: "SELECT 1 FROM users WHERE id = $1",
  visiblePost: "ts.shared_to_profile = true OR ts.user_id = $2",
  postStats: "WITH ORDINALITY",
  socialStats: "AS has_kudoed",
  topExercises: "PARTITION BY tse.session_id",
  recentKudos: "rk.created_at DESC",
  insertKudo: "INSERT INTO session_kudos",
  deleteKudo: "DELETE FROM session_kudos",
  countKudos: "kudos_count FROM session_kudos WHERE session_id = $1",
  listKudos: "ORDER BY k.created_at DESC, u.id DESC",
  listComments: "ORDER BY c.created_at ASC",
  insertComment: "INSERT INTO session_comments",
  findComment: "FROM session_comments WHERE id = $1 AND session_id = $2",
  deleteComment: "DELETE FROM session_comments",
  suggested: "AS recent_count",
  historyExercises: "tse.exercise_category",
  historySets: "AS planned_weight_kg",
} as const;

type MockResult = { rows?: unknown[]; error?: unknown };

const whenSqlContains = (patterns: Partial<Record<string, MockResult>>) => {
  mockQuery.mockImplementation((sql: string) => {
    const sqlStr = String(sql);
    for (const [pattern, result] of Object.entries(patterns)) {
      if (result && sqlStr.includes(pattern)) {
        if (result.error) return Promise.reject(result.error);
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

const postRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  user_id: OTHER_USER_ID,
  plan_name: "Push/Pull/Legs",
  note: "Nowy rekord",
  started_at: new Date("2026-05-26T18:32:00Z"),
  finished_at: new Date("2026-05-26T19:29:00Z"),
  duration_sec: 3420,
  cursor_started_at: "2026-05-26T18:32:00.000000Z",
  author_first_name: "Anna",
  author_last_name: "Nowak",
  author_handle: "anna.nowak_d4e5f6",
  author_avatar_url: null,
  ...overrides,
});

const statsRow = {
  session_id: SESSION_ID,
  exercises_count: 6,
  completed_sets_count: 18,
  total_volume_kg: 5230.5,
  muscles: ["chest", "triceps"],
};

const socialRow = {
  session_id: SESSION_ID,
  kudos_count: 3,
  comment_count: 1,
  has_kudoed: false,
};

const topExerciseRows = [
  {
    session_id: SESSION_ID,
    exercise_name: "Wyciskanie sztangi na ławce",
    completed_sets: 4,
    best_weight_kg: 82.5,
    best_reps: 8,
  },
  {
    session_id: SESSION_ID,
    exercise_name: "Podciąganie na drążku",
    completed_sets: 3,
    best_weight_kg: null,
    best_reps: null,
  },
];

const recentKudoRow = {
  session_id: SESSION_ID,
  id: THIRD_USER_ID,
  first_name: "Celina",
  last_name: "Zielińska",
  handle: "celina.z_aaaaaa",
  avatar_url: "/uploads/avatars/c.png",
};

const expectedPost = {
  id: SESSION_ID,
  author: {
    id: OTHER_USER_ID,
    firstName: "Anna",
    lastName: "Nowak",
    handle: "anna.nowak_d4e5f6",
    avatarUrl: null,
  },
  title: "Push/Pull/Legs",
  note: "Nowy rekord",
  startedAt: "2026-05-26T18:32:00.000Z",
  finishedAt: "2026-05-26T19:29:00.000Z",
  durationSec: 3420,
  exercisesCount: 6,
  completedSetsCount: 18,
  totalVolumeKg: 5230.5,
  muscles: ["chest", "triceps"],
  topExercises: [
    {
      name: "Wyciskanie sztangi na ławce",
      completedSets: 4,
      bestSet: { weightKg: 82.5, reps: 8 },
    },
    { name: "Podciąganie na drążku", completedSets: 3, bestSet: null },
  ],
  kudosCount: 3,
  commentCount: 1,
  hasKudoed: false,
  isOwn: false,
  recentKudos: [
    {
      id: THIRD_USER_ID,
      firstName: "Celina",
      lastName: "Zielińska",
      handle: "celina.z_aaaaaa",
      avatarUrl: "/uploads/avatars/c.png",
    },
  ],
};

const postAggregates = {
  [SQL.postStats]: { rows: [statsRow] },
  [SQL.socialStats]: { rows: [socialRow] },
  [SQL.topExercises]: { rows: topExerciseRows },
  [SQL.recentKudos]: { rows: [recentKudoRow] },
};

const userListRow = {
  id: THIRD_USER_ID,
  first_name: "Celina",
  last_name: "Zielińska",
  handle: "celina.z_aaaaaa",
  avatar_url: null,
  is_following: true,
};

const commentRow = (overrides: Record<string, unknown> = {}) => ({
  id: COMMENT_ID,
  session_id: SESSION_ID,
  user_id: USER_ID,
  body: "Świetny trening!",
  created_at: new Date("2026-05-26T20:00:00.123Z"),
  cursor_created_at: "2026-05-26T20:00:00.123456Z",
  first_name: "Jan",
  last_name: "Kowalski",
  handle: "jan.kowalski_a1b2c3",
  avatar_url: null,
  ...overrides,
});

const decodeCursor = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
    string,
    string
  >;

const encodeCursor = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

describe("GET /feed", () => {
  beforeEach(resetDbMocks);

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/feed");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns posts with batched aggregates", async () => {
    whenSqlContains({
      [SQL.listFeed]: { rows: [postRow()] },
      ...postAggregates,
    });

    const res = await request(app).get("/feed").set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [expectedPost],
      nextCursor: null,
      hasMore: false,
    });

    const feedCall = findCall(SQL.listFeed);
    expect(feedCall?.[1]).toEqual([USER_ID, 21]);
    const feedSql = String(feedCall?.[0]);
    expect(feedSql).toContain("ts.status = 'completed'");
    expect(feedSql).toContain("ts.shared_to_profile = true");
    expect(feedSql).toContain("ORDER BY ts.started_at DESC, ts.id DESC");
    // aggregates are loaded for the whole page with ANY/unnest, once each
    for (const marker of [
      SQL.postStats,
      SQL.socialStats,
      SQL.topExercises,
      SQL.recentKudos,
    ]) {
      const calls = mockQuery.mock.calls.filter((call) =>
        String(call[0]).includes(marker),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0][1][0]).toEqual([SESSION_ID]);
    }
    expect(findCall(SQL.socialStats)?.[1]).toEqual([[SESSION_ID], USER_ID]);
  });

  it("marks own posts and kudoed posts", async () => {
    whenSqlContains({
      [SQL.listFeed]: { rows: [postRow({ user_id: USER_ID })] },
      [SQL.socialStats]: { rows: [{ ...socialRow, has_kudoed: true }] },
    });

    const res = await request(app).get("/feed").set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      isOwn: true,
      hasKudoed: true,
      exercisesCount: 0,
      muscles: [],
      topExercises: [],
      recentKudos: [],
    });
  });

  it("paginates with an opaque keyset cursor", async () => {
    whenSqlContains({
      [SQL.listFeed]: {
        rows: [
          postRow(),
          postRow({
            id: SESSION_ID_2,
            cursor_started_at: "2026-05-25T10:00:00.654321Z",
          }),
          postRow({ id: SESSION_ID_3 }),
        ],
      },
    });

    const first = await request(app).get("/feed?limit=2").set(authHeaders());

    expect(first.status).toBe(200);
    expect(first.body.items.map((p: { id: string }) => p.id)).toEqual([
      SESSION_ID,
      SESSION_ID_2,
    ]);
    expect(first.body.hasMore).toBe(true);
    expect(decodeCursor(first.body.nextCursor)).toEqual({
      startedAt: "2026-05-25T10:00:00.654321Z",
      id: SESSION_ID_2,
    });
    expect(findCall(SQL.listFeed)?.[1]).toEqual([USER_ID, 3]);

    mockQuery.mockClear();
    const second = await request(app)
      .get(`/feed?limit=2&cursor=${first.body.nextCursor}`)
      .set(authHeaders());

    expect(second.status).toBe(200);
    const call = findCall(SQL.listFeed);
    expect(String(call?.[0])).toContain(
      "(ts.started_at, ts.id) < ($3::timestamptz, $4::uuid)",
    );
    expect(call?.[1]).toEqual([
      USER_ID,
      3,
      "2026-05-25T10:00:00.654321Z",
      SESSION_ID_2,
    ]);
  });

  it("skips aggregate queries for an empty page", async () => {
    whenSqlContains({});
    const res = await request(app).get("/feed").set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["garbage", "not-a-cursor"],
    ["wrong payload", encodeCursor({ startedAt: "yesterday", id: SESSION_ID })],
    [
      "comment cursor",
      encodeCursor({ createdAt: "2026-05-25T10:00:00Z", id: SESSION_ID }),
    ],
  ])("returns 400 invalid_cursor for %s", async (_label, cursor) => {
    const res = await request(app)
      .get(`/feed?cursor=${cursor}`)
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_cursor");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(["0", "51", "abc", "1.5"])(
    "returns 400 invalid_limit for limit=%s",
    async (limit) => {
      const res = await request(app)
        .get(`/feed?limit=${limit}`)
        .set(authHeaders());
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_limit");
    },
  );
});

describe("GET /users/:userId/posts", () => {
  beforeEach(resetDbMocks);

  it("returns 401 without auth", async () => {
    const res = await request(app).get(`/users/${OTHER_USER_ID}/posts`);
    expect(res.status).toBe(401);
  });

  it("returns the author's shared posts in the feed shape", async () => {
    whenSqlContains({
      [SQL.userExists]: { rows: [{ "?column?": 1 }] },
      [SQL.listUserPosts]: { rows: [postRow()] },
      ...postAggregates,
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/posts`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [expectedPost],
      nextCursor: null,
      hasMore: false,
    });
    const call = findCall(SQL.listUserPosts);
    expect(call?.[1]).toEqual([OTHER_USER_ID, 11]);
    const sql = String(call?.[0]);
    expect(sql).toContain("ts.status = 'completed'");
    expect(sql).toContain("ts.shared_to_profile = true");
    expect(sql).toContain("ORDER BY ts.started_at DESC, ts.id DESC");
  });

  it("paginates with a keyset cursor", async () => {
    whenSqlContains({
      [SQL.userExists]: { rows: [{ "?column?": 1 }] },
      [SQL.listUserPosts]: {
        rows: [
          postRow(),
          postRow({
            id: SESSION_ID_2,
            cursor_started_at: "2026-05-25T10:00:00.654321Z",
          }),
        ],
      },
    });

    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/posts?limit=1`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.hasMore).toBe(true);
    expect(decodeCursor(res.body.nextCursor)).toEqual({
      startedAt: "2026-05-26T18:32:00.000000Z",
      id: SESSION_ID,
    });

    mockQuery.mockClear();
    await request(app)
      .get(`/users/${OTHER_USER_ID}/posts?limit=1&cursor=${res.body.nextCursor}`)
      .set(authHeaders());
    expect(findCall(SQL.listUserPosts)?.[1]).toEqual([
      OTHER_USER_ID,
      2,
      "2026-05-26T18:32:00.000000Z",
      SESSION_ID,
    ]);
  });

  it("returns 404 user_not_found for an unknown user", async () => {
    whenSqlContains({});
    const res = await request(app)
      .get(`/users/${OTHER_USER_ID}/posts`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });

  it("returns 400 invalid_uuid for a malformed id", async () => {
    const res = await request(app)
      .get("/users/not-a-uuid/posts")
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_uuid");
  });
});

describe("GET /posts/:sessionId", () => {
  beforeEach(resetDbMocks);

  const exerciseRow = {
    id: "e1000000-0000-4000-8000-000000000001",
    session_id: SESSION_ID,
    exercise_id: "a1000000-0000-0000-0000-000000000001",
    exercise_name: "Wyciskanie sztangi na ławce",
    exercise_muscles: ["chest", "triceps"],
    exercise_category: "compound",
    exercise_image_url: "/uploads/exercise-images/bench.png",
    position: 0,
  };

  const setRow = {
    id: "e2000000-0000-4000-8000-000000000001",
    session_exercise_id: exerciseRow.id,
    set_index: 1,
    planned_weight_kg: "80",
    planned_reps: "8",
    planned_rir: "2",
    planned_tempo: "3010",
    actual_weight_kg: "82,5",
    actual_reps: "8",
    actual_rir: null,
    actual_tempo: null,
    completed: true,
    completed_at: new Date("2026-05-26T18:40:00Z"),
  };

  it("returns the post with exercises and sets", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      ...postAggregates,
      [SQL.historyExercises]: { rows: [exerciseRow] },
      [SQL.historySets]: { rows: [setRow] },
    });

    const res = await request(app)
      .get(`/posts/${SESSION_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...expectedPost,
      exercises: [
        {
          exerciseId: "a1000000-0000-0000-0000-000000000001",
          exerciseName: "Wyciskanie sztangi na ławce",
          exerciseMuscles: ["chest", "triceps"],
          exerciseCategory: "compound",
          imageUrl: "/uploads/exercise-images/bench.png",
          sets: [
            {
              setIndex: 1,
              planned: { weightKg: 80, reps: 8, rir: 2, tempo: "3010" },
              actual: { weightKg: 82.5, reps: 8, rir: null, tempo: null },
              completed: true,
              completedAt: "2026-05-26T18:40:00.000Z",
            },
          ],
        },
      ],
    });
    const visibleCall = findCall(SQL.visiblePost);
    expect(visibleCall?.[1]).toEqual([SESSION_ID, USER_ID]);
    expect(String(visibleCall?.[0])).toContain("ts.status = 'completed'");
  });

  it("returns 404 post_not_found when not visible", async () => {
    whenSqlContains({});
    const res = await request(app)
      .get(`/posts/${SESSION_ID}`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("returns 400 invalid_uuid for a malformed id", async () => {
    const res = await request(app).get("/posts/not-a-uuid").set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_uuid");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get(`/posts/${SESSION_ID}`);
    expect(res.status).toBe(401);
  });
});

describe("kudos", () => {
  beforeEach(resetDbMocks);

  it("POST /posts/:id/kudos gives a kudo and returns the count", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.countKudos]: { rows: [{ kudos_count: 4 }] },
    });

    const res = await request(app)
      .post(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasKudoed: true, kudosCount: 4 });
    const insert = findCall(SQL.insertKudo);
    expect(String(insert?.[0])).toContain("ON CONFLICT DO NOTHING");
    expect(insert?.[1]).toEqual([SESSION_ID, USER_ID]);
  });

  it("POST /posts/:id/kudos returns 400 cannot_kudo_own_post", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow({ user_id: USER_ID })] },
    });

    const res = await request(app)
      .post(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cannot_kudo_own_post");
    expect(findCall(SQL.insertKudo)).toBeUndefined();
  });

  it("POST /posts/:id/kudos returns 404 when the post is not visible", async () => {
    whenSqlContains({});
    const res = await request(app)
      .post(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("POST /posts/:id/kudos maps FK violation (session deleted mid-request) to 404", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.insertKudo]: { error: Object.assign(new Error("fk"), { code: "23503" }) },
    });
    const res = await request(app)
      .post(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("POST /posts/:id/kudos returns 400 invalid_uuid", async () => {
    const res = await request(app).post("/posts/nope/kudos").set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_uuid");
  });

  it("DELETE /posts/:id/kudos removes the kudo and returns the count", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.countKudos]: { rows: [{ kudos_count: 2 }] },
    });

    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasKudoed: false, kudosCount: 2 });
    expect(findCall(SQL.deleteKudo)?.[1]).toEqual([SESSION_ID, USER_ID]);
  });

  it("DELETE /posts/:id/kudos returns 404 when the post is not visible", async () => {
    whenSqlContains({});
    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("GET /posts/:id/kudos lists kudo givers like follower lists", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.listKudos]: { rows: [userListRow] },
    });

    const res = await request(app)
      .get(`/posts/${SESSION_ID}/kudos?limit=10&offset=5`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: THIRD_USER_ID,
        firstName: "Celina",
        lastName: "Zielińska",
        handle: "celina.z_aaaaaa",
        avatarUrl: null,
        isFollowing: true,
      },
    ]);
    expect(findCall(SQL.listKudos)?.[1]).toEqual([SESSION_ID, USER_ID, 10, 5]);
  });

  it("GET /posts/:id/kudos uses defaults limit=50 offset=0", async () => {
    whenSqlContains({ [SQL.visiblePost]: { rows: [postRow()] } });
    const res = await request(app)
      .get(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(findCall(SQL.listKudos)?.[1]).toEqual([SESSION_ID, USER_ID, 50, 0]);
  });

  it.each([
    ["limit=0", "invalid_limit"],
    ["limit=101", "invalid_limit"],
    ["offset=-1", "invalid_offset"],
  ])("GET /posts/:id/kudos?%s returns 400 %s", async (query, code) => {
    const res = await request(app)
      .get(`/posts/${SESSION_ID}/kudos?${query}`)
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
  });

  it("GET /posts/:id/kudos returns 404 when the post is not visible", async () => {
    whenSqlContains({});
    const res = await request(app)
      .get(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });
});

describe("comments", () => {
  beforeEach(resetDbMocks);

  it("GET /posts/:id/comments lists oldest first with isOwn/canDelete for a non-owner", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.listComments]: {
        rows: [
          commentRow(),
          commentRow({
            id: COMMENT_ID_2,
            user_id: THIRD_USER_ID,
            body: "Brawo",
            first_name: "Celina",
          }),
        ],
      },
    });

    const res = await request(app)
      .get(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: COMMENT_ID,
          author: {
            id: USER_ID,
            firstName: "Jan",
            lastName: "Kowalski",
            handle: "jan.kowalski_a1b2c3",
            avatarUrl: null,
          },
          body: "Świetny trening!",
          createdAt: "2026-05-26T20:00:00.123Z",
          isOwn: true,
          canDelete: true,
        },
        expect.objectContaining({
          id: COMMENT_ID_2,
          isOwn: false,
          canDelete: false,
        }),
      ],
      nextCursor: null,
      hasMore: false,
    });
    expect(findCall(SQL.listComments)?.[1]).toEqual([SESSION_ID, 31]);
  });

  it("GET /posts/:id/comments lets the post owner delete every comment", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow({ user_id: USER_ID })] },
      [SQL.listComments]: {
        rows: [commentRow({ user_id: THIRD_USER_ID })],
      },
    });

    const res = await request(app)
      .get(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ isOwn: false, canDelete: true });
  });

  it("GET /posts/:id/comments paginates with a µs-precision cursor", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.listComments]: {
        rows: [commentRow(), commentRow({ id: COMMENT_ID_2 })],
      },
    });

    const first = await request(app)
      .get(`/posts/${SESSION_ID}/comments?limit=1`)
      .set(authHeaders());

    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.hasMore).toBe(true);
    expect(decodeCursor(first.body.nextCursor)).toEqual({
      createdAt: "2026-05-26T20:00:00.123456Z",
      id: COMMENT_ID,
    });

    mockQuery.mockClear();
    const second = await request(app)
      .get(`/posts/${SESSION_ID}/comments?limit=1&cursor=${first.body.nextCursor}`)
      .set(authHeaders());

    expect(second.status).toBe(200);
    const call = findCall(SQL.listComments);
    expect(String(call?.[0])).toContain(
      "(c.created_at, c.id) > ($3::timestamptz, $4::uuid)",
    );
    expect(call?.[1]).toEqual([
      SESSION_ID,
      2,
      "2026-05-26T20:00:00.123456Z",
      COMMENT_ID,
    ]);
  });

  it.each([
    ["garbage", "zzz"],
    [
      "feed cursor",
      encodeCursor({ startedAt: "2026-05-25T10:00:00Z", id: SESSION_ID }),
    ],
  ])("GET /posts/:id/comments returns 400 invalid_cursor for %s", async (_l, cursor) => {
    const res = await request(app)
      .get(`/posts/${SESSION_ID}/comments?cursor=${cursor}`)
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_cursor");
  });

  it("GET /posts/:id/comments returns 400 invalid_limit", async () => {
    const res = await request(app)
      .get(`/posts/${SESSION_ID}/comments?limit=101`)
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_limit");
  });

  it("GET /posts/:id/comments returns 404 when the post is not visible", async () => {
    whenSqlContains({});
    const res = await request(app)
      .get(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("POST /posts/:id/comments creates a trimmed comment", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.insertComment]: { rows: [commentRow()] },
    });

    const res = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders())
      .send({ body: "   Świetny trening!  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: COMMENT_ID,
      body: "Świetny trening!",
      isOwn: true,
      canDelete: true,
      author: { id: USER_ID },
    });
    expect(findCall(SQL.insertComment)?.[1]).toEqual([
      SESSION_ID,
      USER_ID,
      "Świetny trening!",
    ]);
  });

  it("POST /posts/:id/comments accepts 500 code points (emoji)", async () => {
    const body = "💪".repeat(500);
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.insertComment]: { rows: [commentRow({ body })] },
    });
    const res = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders())
      .send({ body });
    expect(res.status).toBe(201);
  });

  it.each([
    ["empty", { body: "" }],
    ["whitespace", { body: "   " }],
    ["too long", { body: "a".repeat(501) }],
    ["missing", {}],
    ["not a string", { body: 42 }],
  ])("POST /posts/:id/comments returns 400 invalid_comment_body (%s)", async (_l, body) => {
    const res = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders("99999999-0000-4000-8000-000000000009"))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_comment_body");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /posts/:id/comments returns 404 when the post is not visible", async () => {
    whenSqlContains({});
    const res = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders())
      .send({ body: "hej" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
    expect(findCall(SQL.insertComment)).toBeUndefined();
  });

  it("POST /posts/:id/comments maps FK violation to 404", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.insertComment]: {
        error: Object.assign(new Error("fk"), { code: "23503" }),
      },
    });
    const res = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders())
      .send({ body: "hej" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("POST /posts/:id/comments is rate limited per user (30/min)", async () => {
    const limitedUser = "dddddddd-0000-4000-8000-000000000004";
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.insertComment]: { rows: [commentRow({ user_id: limitedUser })] },
    });

    for (let i = 0; i < 30; i += 1) {
      const res = await request(app)
        .post(`/posts/${SESSION_ID}/comments`)
        .set(authHeaders(limitedUser))
        .send({ body: `komentarz ${i}` });
      expect(res.status).toBe(201);
    }

    const limited = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders(limitedUser))
      .send({ body: "jeszcze jeden" });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("too_many_requests");

    const otherUser = await request(app)
      .post(`/posts/${SESSION_ID}/comments`)
      .set(authHeaders("eeeeeeee-0000-4000-8000-000000000005"))
      .send({ body: "inny" });
    expect(otherUser.status).toBe(201);
  });

  it("DELETE /posts/:id/comments/:commentId lets the author delete", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.findComment]: { rows: [{ id: COMMENT_ID, user_id: USER_ID }] },
    });

    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/comments/${COMMENT_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(findCall(SQL.findComment)?.[1]).toEqual([COMMENT_ID, SESSION_ID]);
    expect(findCall(SQL.deleteComment)?.[1]).toEqual([COMMENT_ID]);
  });

  it("DELETE /posts/:id/comments/:commentId lets the post owner delete", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow({ user_id: USER_ID })] },
      [SQL.findComment]: { rows: [{ id: COMMENT_ID, user_id: THIRD_USER_ID }] },
    });

    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/comments/${COMMENT_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    expect(findCall(SQL.deleteComment)).toBeDefined();
  });

  it("DELETE /posts/:id/comments/:commentId returns 403 forbidden for others", async () => {
    whenSqlContains({
      [SQL.visiblePost]: { rows: [postRow()] },
      [SQL.findComment]: { rows: [{ id: COMMENT_ID, user_id: THIRD_USER_ID }] },
    });

    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/comments/${COMMENT_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(findCall(SQL.deleteComment)).toBeUndefined();
  });

  it("DELETE /posts/:id/comments/:commentId returns 404 comment_not_found", async () => {
    whenSqlContains({ [SQL.visiblePost]: { rows: [postRow()] } });

    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/comments/${COMMENT_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("comment_not_found");
  });

  it("DELETE /posts/:id/comments/:commentId returns 404 post_not_found", async () => {
    whenSqlContains({});
    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/comments/${COMMENT_ID}`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });

  it("DELETE /posts/:id/comments/:commentId returns 400 invalid_uuid", async () => {
    const res = await request(app)
      .delete(`/posts/${SESSION_ID}/comments/not-a-uuid`)
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_uuid");
  });
});

describe("GET /users/suggested", () => {
  beforeEach(resetDbMocks);

  it("returns suggested users with isFollowing false", async () => {
    whenSqlContains({
      [SQL.suggested]: { rows: [{ ...userListRow, is_following: false }] },
    });

    const res = await request(app).get("/users/suggested").set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: THIRD_USER_ID,
        firstName: "Celina",
        lastName: "Zielińska",
        handle: "celina.z_aaaaaa",
        avatarUrl: null,
        isFollowing: false,
      },
    ]);
    const call = findCall(SQL.suggested);
    expect(call?.[1]).toEqual([USER_ID, 10]);
    expect(String(call?.[0])).toContain("interval '30 days'");
  });

  it("returns 400 invalid_limit for limit over 30", async () => {
    const res = await request(app)
      .get("/users/suggested?limit=31")
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_limit");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/users/suggested");
    expect(res.status).toBe(401);
  });
});

describe("kudos rate limit", () => {
  beforeEach(resetDbMocks);

  it("returns 429 too_many_requests after 120 kudos requests per user per minute", async () => {
    whenSqlContains({});
    const limitedUser = "dddddddd-0000-0000-0000-00000000000d";
    for (let i = 0; i < 120; i++) {
      const res = await request(app)
        [i % 2 === 0 ? "post" : "delete"](`/posts/${SESSION_ID}/kudos`)
        .set(authHeaders(limitedUser));
      expect(res.status).not.toBe(429);
    }
    const limited = await request(app)
      .post(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders(limitedUser));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "too_many_requests" });

    // keyed per user — others are unaffected
    const other = await request(app)
      .delete(`/posts/${SESSION_ID}/kudos`)
      .set(authHeaders(THIRD_USER_ID));
    expect(other.status).not.toBe(429);
  });
});
