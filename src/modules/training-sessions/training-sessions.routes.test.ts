import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockRelease, mockConnect, mockPool, mockGetPool } =
  vi.hoisted(() => {
    const mockQuery = vi.fn();
    const mockRelease = vi.fn();
    const mockConnect = vi.fn(() => ({
      query: mockQuery,
      release: mockRelease,
    }));
    const mockPool = { query: mockQuery, connect: mockConnect };
    const mockGetPool = vi.fn(
      (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
    );
    return { mockQuery, mockRelease, mockConnect, mockPool, mockGetPool };
  });

vi.mock("../../db/pool.js", () => ({
  getPool: mockGetPool,
}));

const { createApp } = await import("../../app.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_EMAIL = "tester@gym.com";
const SESSION_ID = "bbbbbbbb-1000-4000-8000-000000000001";
const SESSION_EXERCISE_ID = "bbbbbbbb-1000-4000-8000-000000000002";
const SESSION_SET_ID = "bbbbbbbb-1000-4000-8000-000000000003";
const CLIENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const EXERCISE_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const SET_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440002";

const makeToken = (sub = USER_ID, email = USER_EMAIL) =>
  jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: "1h" });

const authHeaders = () => ({ Authorization: `Bearer ${makeToken()}` });

const app = createApp();

const validBody = {
  clientId: CLIENT_ID,
  planId: null,
  planClientId: "550e8400-e29b-41d4-a716-446655440010",
  planName: "FBW",
  status: "completed",
  note: null,
  startedAt: "2026-05-12T10:00:00.000Z",
  finishedAt: "2026-05-12T11:00:00.000Z",
  exercises: [
    {
      clientId: EXERCISE_CLIENT_ID,
      exerciseId: null,
      exerciseClientId: "550e8400-e29b-41d4-a716-446655440011",
      exerciseName: "Bench",
      exerciseMuscles: ["chest"],
      exerciseCategory: "compound",
      exerciseImageUrl: null,
      sets: [
        {
          clientId: SET_CLIENT_ID,
          plannedWeight: "60",
          plannedReps: "8",
          actualWeight: "62.5",
          actualReps: "8",
          actualTempo: "3-1-1",
          completed: true,
          completedAt: "2026-05-12T10:15:00.000Z",
        },
      ],
    },
  ],
};

const sessionRow = {
  id: SESSION_ID,
  client_id: CLIENT_ID,
  user_id: USER_ID,
  plan_id: null,
  plan_client_id: validBody.planClientId,
  plan_name: "FBW",
  status: "completed",
  note: null,
  started_at: new Date(validBody.startedAt),
  finished_at: new Date(validBody.finishedAt),
  shared_to_profile: true,
  created_at: new Date("2026-05-12T10:00:00Z"),
  updated_at: new Date("2026-05-12T11:00:00Z"),
};

const sessionExerciseRow = {
  id: SESSION_EXERCISE_ID,
  client_id: EXERCISE_CLIENT_ID,
  session_id: SESSION_ID,
  exercise_id: null,
  exercise_client_id: validBody.exercises[0].exerciseClientId,
  exercise_name: "Bench",
  exercise_muscles: ["chest"],
  exercise_category: "compound",
  exercise_image_url: null,
  position: 0,
};

const sessionSetRow = {
  id: SESSION_SET_ID,
  client_id: SET_CLIENT_ID,
  session_exercise_id: SESSION_EXERCISE_ID,
  position: 0,
  planned_weight: "60",
  planned_reps: "8",
  planned_rir: null,
  planned_tempo: null,
  actual_weight: "62.5",
  actual_reps: "8",
  actual_rir: null,
  actual_tempo: "3-1-1",
  completed: true,
  completed_at: new Date("2026-05-12T10:15:00Z"),
};

const whenSqlContains = (
  patterns: Record<string, { rows?: unknown[]; rowCount?: number }>,
) => {
  mockQuery.mockImplementation((sql: string) => {
    const sqlStr = String(sql);
    for (const [pattern, result] of Object.entries(patterns)) {
      if (sqlStr.includes(pattern)) {
        return Promise.resolve({
          rows: result.rows ?? [],
          rowCount: result.rowCount ?? result.rows?.length ?? 0,
        });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

describe("training sessions routes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockClear();
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
  });

  it("POST /training-sessions returns 401 without auth", async () => {
    const res = await request(app).post("/training-sessions").send(validBody);
    expect(res.status).toBe(401);
  });

  it("POST /training-sessions upserts by clientId and returns snapshot", async () => {
    whenSqlContains({
      "INSERT INTO training_sessions": {
        rows: [{ id: SESSION_ID, inserted: true }],
      },
      "DELETE FROM training_session_exercises": { rows: [] },
      "INSERT INTO training_session_exercises": {
        rows: [{ id: SESSION_EXERCISE_ID }],
      },
      "INSERT INTO training_session_sets": { rows: [] },
      "FROM training_sessions": { rows: [sessionRow] },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send({ ...validBody, sharedToProfile: true });

    expect(res.status).toBe(201);
    const insertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_sessions"),
    );
    expect(insertCall?.[1]).toContain(true);
    expect(res.body).toMatchObject({
      id: SESSION_ID,
      clientId: CLIENT_ID,
      planName: "FBW",
      status: "completed",
      sharedToProfile: true,
      exercises: [
        {
          exerciseName: "Bench",
          sets: [
            { actualWeight: "62.5", actualTempo: "3-1-1", completed: true },
          ],
        },
      ],
    });
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("POST /training-sessions defaults sharedToProfile to false", async () => {
    whenSqlContains({
      "INSERT INTO training_sessions": {
        rows: [{ id: SESSION_ID, inserted: true }],
      },
      "INSERT INTO training_session_exercises": {
        rows: [{ id: SESSION_EXERCISE_ID }],
      },
      "FROM training_sessions": {
        rows: [{ ...sessionRow, shared_to_profile: false }],
      },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(201);
    const insertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_sessions"),
    );
    expect(insertCall?.[1]?.at(-1)).toBe(false);
    expect(res.body.sharedToProfile).toBe(false);
  });

  it("POST /training-sessions returns 400 when startedAt is null", async () => {
    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send({ ...validBody, startedAt: null });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /training-sessions keeps the snapshot but drops links to exercises no longer visible", async () => {
    whenSqlContains({
      "SELECT id FROM exercises": { rows: [] },
      "INSERT INTO training_sessions": {
        rows: [{ id: SESSION_ID, inserted: true }],
      },
      "DELETE FROM training_session_exercises": { rows: [] },
      "INSERT INTO training_session_exercises": {
        rows: [{ id: SESSION_EXERCISE_ID }],
      },
      "INSERT INTO training_session_sets": { rows: [] },
      "FROM training_sessions": { rows: [sessionRow] },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send({
        ...validBody,
        exercises: [
          {
            ...validBody.exercises[0],
            exerciseId: "a1000000-0000-0000-0000-000000000001",
          },
        ],
      });

    expect(res.status).toBe(201);
    const exerciseInsert = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_session_exercises"),
    );
    expect(exerciseInsert?.[1]?.[3]).toBeNull();
    expect(exerciseInsert?.[1]?.[5]).toBe("Bench");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("POST /training-sessions drops the plan link when the plan no longer exists", async () => {
    whenSqlContains({
      "FROM training_plans": { rows: [], rowCount: 0 },
      "INSERT INTO training_sessions": {
        rows: [{ id: SESSION_ID, inserted: true }],
      },
      "DELETE FROM training_session_exercises": { rows: [] },
      "INSERT INTO training_session_exercises": {
        rows: [{ id: SESSION_EXERCISE_ID }],
      },
      "INSERT INTO training_session_sets": { rows: [] },
      "FROM training_sessions": { rows: [sessionRow] },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send({ ...validBody, planId: "a2000000-0000-0000-0000-000000000001" });

    expect(res.status).toBe(201);
    const sessionInsert = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_sessions"),
    );
    expect(sessionInsert?.[1]?.[2]).toBeNull();
    expect(sessionInsert?.[1]?.[4]).toBe("FBW");
  });

  it("GET /training-sessions/history returns completed sessions", async () => {
    whenSqlContains({
      "FROM training_sessions": { rows: [sessionRow] },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .get("/training-sessions/history")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body).toMatchObject({
      items: [{ id: SESSION_ID, status: "completed" }],
      nextCursor: null,
      hasMore: false,
    });
    const historySql = mockQuery.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("FROM training_sessions"));
    expect(historySql).toContain("ORDER BY started_at DESC, id DESC");
    expect(historySql).toContain("LIMIT");
  });

  it("GET /training-sessions/history returns 400 for invalid limit", async () => {
    const res = await request(app)
      .get("/training-sessions/history?limit=101")
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_limit" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /training-sessions/history pages with a keyset cursor", async () => {
    whenSqlContains({
      "FROM training_sessions": { rows: [sessionRow] },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const cursor = Buffer.from(
      JSON.stringify({
        startedAt: "2026-05-12T10:00:00.000Z",
        id: SESSION_ID,
      }),
      "utf8",
    ).toString("base64url");

    const res = await request(app)
      .get(
        `/training-sessions/history?limit=1&cursor=${cursor}&updatedSince=2026-01-01T00:00:00.000Z`,
      )
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    const historyCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("FROM training_sessions"),
    );
    expect(String(historyCall?.[0])).toContain("updated_at >");
    expect(String(historyCall?.[0])).toContain("started_at <");
    expect(historyCall?.[1]).toEqual([
      USER_ID,
      new Date("2026-01-01T00:00:00.000Z"),
      "2026-05-12T10:00:00.000Z",
      SESSION_ID,
      2,
    ]);
  });

  it("PATCH /training-sessions/:id/shared-to-profile updates only the flag", async () => {
    whenSqlContains({
      "SET shared_to_profile = $1": { rowCount: 1 },
      "FROM training_sessions": {
        rows: [{ ...sessionRow, shared_to_profile: true }],
      },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .patch(`/training-sessions/${SESSION_ID}/shared-to-profile`)
      .set(authHeaders())
      .send({ sharedToProfile: true });

    expect(res.status).toBe(200);
    expect(res.body.sharedToProfile).toBe(true);
    const updateCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("SET shared_to_profile = $1"),
    );
    expect(updateCall?.[1]).toEqual([true, SESSION_ID, USER_ID]);
  });

  it("PATCH /training-sessions/:id/shared-to-profile returns 404 when missing", async () => {
    whenSqlContains({
      "SET shared_to_profile = $1": { rowCount: 0 },
    });

    const res = await request(app)
      .patch(`/training-sessions/${SESSION_ID}/shared-to-profile`)
      .set(authHeaders())
      .send({ sharedToProfile: true });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
  });

  const TOMBSTONE_SQL = "FROM training_session_tombstones";
  const OTHER_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440099";

  const sqlCalls = () => mockQuery.mock.calls.map((call) => String(call[0]));

  it("DELETE /training-sessions/:id returns 401 without auth", async () => {
    const res = await request(app).delete(`/training-sessions/${SESSION_ID}`);
    expect(res.status).toBe(401);
  });

  it("DELETE /training-sessions/:id deletes the session and leaves a tombstone in one transaction", async () => {
    whenSqlContains({
      "SELECT client_id FROM training_sessions": {
        rows: [{ client_id: CLIENT_ID }],
      },
      "DELETE FROM training_sessions": { rowCount: 1 },
      "INSERT INTO training_session_tombstones": { rowCount: 1 },
    });

    const res = await request(app)
      .delete(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    const calls = sqlCalls();
    const begin = calls.indexOf("BEGIN");
    const del = calls.findIndex((sql) =>
      sql.includes("DELETE FROM training_sessions"),
    );
    const tomb = calls.findIndex((sql) =>
      sql.includes("INSERT INTO training_session_tombstones"),
    );
    const commit = calls.indexOf("COMMIT");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(del);
    expect(del).toBeLessThan(tomb);
    expect(tomb).toBeLessThan(commit);
    expect(calls.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(
      true,
    );
    const deleteCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("DELETE FROM training_sessions"),
    );
    expect(deleteCall?.[1]).toEqual([SESSION_ID, USER_ID]);
    const tombCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_session_tombstones"),
    );
    expect(tombCall?.[1]).toEqual([SESSION_ID, USER_ID, CLIENT_ID]);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("DELETE /training-sessions/:id is idempotent when the user already deleted it", async () => {
    whenSqlContains({
      "SELECT client_id FROM training_sessions": { rows: [] },
      [TOMBSTONE_SQL]: { rows: [{ "?column?": 1 }] },
    });

    const res = await request(app)
      .delete(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    expect(
      sqlCalls().some((sql) =>
        sql.includes("INSERT INTO training_session_tombstones"),
      ),
    ).toBe(false);
    const tombCheck = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes(TOMBSTONE_SQL),
    );
    expect(tombCheck?.[1]).toEqual([USER_ID, SESSION_ID, null]);
  });

  it("DELETE /training-sessions/:id returns 404 when not the user's and not tombstoned", async () => {
    whenSqlContains({
      "SELECT client_id FROM training_sessions": { rows: [] },
      [TOMBSTONE_SQL]: { rows: [] },
    });

    const res = await request(app)
      .delete(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
    expect(sqlCalls().some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("DELETE /training-sessions/:id returns 400 for an invalid uuid", async () => {
    const res = await request(app)
      .delete("/training-sessions/not-a-uuid")
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_uuid" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("DELETE /training-sessions/by-client-id/:clientId deletes and tombstones", async () => {
    whenSqlContains({
      "DELETE FROM training_sessions": { rows: [{ id: SESSION_ID }] },
      "INSERT INTO training_session_tombstones": { rowCount: 1 },
    });

    const res = await request(app)
      .delete(`/training-sessions/by-client-id/${CLIENT_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    const calls = sqlCalls();
    expect(calls.indexOf("BEGIN")).toBeLessThan(
      calls.findIndex((sql) => sql.includes("pg_advisory_xact_lock")),
    );
    const deleteCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("DELETE FROM training_sessions"),
    );
    expect(String(deleteCall?.[0])).toContain("client_id = $2");
    expect(deleteCall?.[1]).toEqual([USER_ID, CLIENT_ID]);
    const tombCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_session_tombstones"),
    );
    expect(String(tombCall?.[0])).toContain("DO NOTHING");
    expect(tombCall?.[1]).toEqual([SESSION_ID, USER_ID, CLIENT_ID]);
    expect(calls.at(-1)).toBe("COMMIT");
  });

  it("DELETE /training-sessions/by-client-id/:clientId tombstones a session the server never saw", async () => {
    whenSqlContains({
      "DELETE FROM training_sessions": { rows: [] },
      "INSERT INTO training_session_tombstones": { rowCount: 1 },
    });

    const res = await request(app)
      .delete(`/training-sessions/by-client-id/${CLIENT_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    const tombCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_session_tombstones"),
    );
    const [generatedId, userId, clientId] = tombCall?.[1] as string[];
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(generatedId).not.toBe(CLIENT_ID);
    expect([userId, clientId]).toEqual([USER_ID, CLIENT_ID]);
  });

  it("DELETE /training-sessions/by-client-id/:clientId returns 400 for an invalid uuid", async () => {
    const res = await request(app)
      .delete("/training-sessions/by-client-id/nope")
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_uuid" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /training-sessions returns 410 when the clientId was deleted", async () => {
    whenSqlContains({ [TOMBSTONE_SQL]: { rows: [{ "?column?": 1 }] } });

    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "session_deleted" });
    const calls = sqlCalls();
    expect(calls.some((sql) => sql.includes("INSERT INTO"))).toBe(false);
    expect(calls.at(-1)).toBe("ROLLBACK");
    const lockIndex = calls.findIndex((sql) =>
      sql.includes("pg_advisory_xact_lock"),
    );
    expect(lockIndex).toBeGreaterThan(calls.indexOf("BEGIN"));
    expect(lockIndex).toBeLessThan(
      calls.findIndex((sql) => sql.includes(TOMBSTONE_SQL)),
    );
    const tombCheck = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes(TOMBSTONE_SQL),
    );
    expect(tombCheck?.[1]).toEqual([USER_ID, null, CLIENT_ID]);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("PUT /training-sessions/:id returns 410 when the session was deleted", async () => {
    whenSqlContains({ [TOMBSTONE_SQL]: { rows: [{ "?column?": 1 }] } });

    const res = await request(app)
      .put(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "session_deleted" });
    expect(sqlCalls().some((sql) => sql.includes("UPDATE training_sessions"))).toBe(
      false,
    );
    const tombCheck = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes(TOMBSTONE_SQL),
    );
    expect(tombCheck?.[1]).toEqual([USER_ID, SESSION_ID, CLIENT_ID]);
  });

  it("PUT /training-sessions/:id returns 410 when a concurrent delete wins the row lock", async () => {
    let tombstoneChecks = 0;
    mockQuery.mockImplementation((sql: string) => {
      const sqlStr = String(sql);
      if (sqlStr.includes(TOMBSTONE_SQL)) {
        tombstoneChecks += 1;
        const rows = tombstoneChecks > 1 ? [{ "?column?": 1 }] : [];
        return Promise.resolve({ rows, rowCount: rows.length });
      }
      if (sqlStr.includes("UPDATE training_sessions"))
        return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .put(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "session_deleted" });
    expect(tombstoneChecks).toBe(2);
  });

  it("PATCH /training-sessions/:id/shared-to-profile returns 410 when the session was deleted", async () => {
    whenSqlContains({
      "SET shared_to_profile = $1": { rowCount: 0 },
      [TOMBSTONE_SQL]: { rows: [{ "?column?": 1 }] },
    });

    const res = await request(app)
      .patch(`/training-sessions/${SESSION_ID}/shared-to-profile`)
      .set(authHeaders())
      .send({ sharedToProfile: true });

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "session_deleted" });
  });

  it("PUT /training-sessions/:id edits a completed session in place", async () => {
    whenSqlContains({
      "UPDATE training_sessions": { rowCount: 1 },
      "INSERT INTO training_session_exercises": {
        rows: [{ id: SESSION_EXERCISE_ID }],
      },
      "FROM training_sessions": {
        rows: [
          {
            ...sessionRow,
            plan_name: "FBW edited",
            note: "Po edycji",
            shared_to_profile: true,
            updated_at: new Date("2026-09-15T12:00:00Z"),
          },
        ],
      },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .put(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders())
      .send({
        ...validBody,
        planName: "FBW edited",
        note: "Po edycji",
        startedAt: "2026-05-12T09:30:00.000Z",
        finishedAt: "2026-05-12T11:30:00.000Z",
        sharedToProfile: true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: SESSION_ID,
      planName: "FBW edited",
      note: "Po edycji",
      status: "completed",
      sharedToProfile: true,
      updatedAt: "2026-09-15T12:00:00.000Z",
    });
    const calls = sqlCalls();
    // No active-session guard for a completed session, no re-created row.
    expect(calls.some((sql) => sql.includes("status = 'active'"))).toBe(false);
    expect(calls.some((sql) => sql.includes("INSERT INTO training_sessions"))).toBe(
      false,
    );
    expect(calls.some((sql) => sql.includes("DELETE FROM training_sessions"))).toBe(
      false,
    );
    expect(
      calls.some((sql) => sql.includes("DELETE FROM training_session_exercises")),
    ).toBe(true);
    const updateCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("UPDATE training_sessions"),
    );
    expect(updateCall?.[1]).toEqual([
      null,
      validBody.planClientId,
      "FBW edited",
      "completed",
      "Po edycji",
      new Date("2026-05-12T09:30:00.000Z"),
      new Date("2026-05-12T11:30:00.000Z"),
      true,
      SESSION_ID,
      USER_ID,
    ]);
    expect(calls.at(-1)).toBe("COMMIT");
  });

  it("PUT /training-sessions/:id preserves sharedToProfile=false as sent", async () => {
    whenSqlContains({
      "UPDATE training_sessions": { rowCount: 1 },
      "FROM training_sessions": {
        rows: [{ ...sessionRow, shared_to_profile: false }],
      },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    const res = await request(app)
      .put(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders())
      .send({ ...validBody, sharedToProfile: false });

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("UPDATE training_sessions"),
    );
    expect(updateCall?.[1]?.[7]).toBe(false);
  });

  it("PUT /training-sessions/:id returns 400 invalid_date_range when finishedAt < startedAt", async () => {
    const res = await request(app)
      .put(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders())
      .send({
        ...validBody,
        startedAt: "2026-05-12T11:00:00.000Z",
        finishedAt: "2026-05-12T10:59:59.999Z",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_date_range" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /training-sessions returns 400 invalid_date_range when finishedAt < startedAt", async () => {
    const res = await request(app)
      .post("/training-sessions")
      .set(authHeaders())
      .send({
        ...validBody,
        finishedAt: "2026-05-12T09:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_date_range" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /training-sessions accepts finishedAt equal to startedAt and a null finishedAt", async () => {
    whenSqlContains({
      "INSERT INTO training_sessions": {
        rows: [{ id: SESSION_ID, inserted: true }],
      },
      "FROM training_sessions": { rows: [sessionRow] },
      "FROM training_session_exercises": { rows: [sessionExerciseRow] },
      "FROM training_session_sets": { rows: [sessionSetRow] },
    });

    for (const finishedAt of [validBody.startedAt, null]) {
      const res = await request(app)
        .post("/training-sessions")
        .set(authHeaders())
        .send({ ...validBody, finishedAt });
      expect(res.status).toBe(201);
    }
  });

  it("GET /training-sessions/history returns deleted[] since updatedSince on the first page", async () => {
    const deletedAt = new Date("2026-09-15T10:00:00Z");
    whenSqlContains({
      [TOMBSTONE_SQL]: {
        rows: [
          { session_id: SESSION_ID, client_id: CLIENT_ID, deleted_at: deletedAt },
          {
            session_id: "bbbbbbbb-1000-4000-8000-000000000009",
            client_id: null,
            deleted_at: deletedAt,
          },
        ],
      },
      "FROM training_sessions": { rows: [] },
    });

    const res = await request(app)
      .get("/training-sessions/history?updatedSince=2026-09-01T00:00:00.000Z")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      deleted: [
        {
          id: SESSION_ID,
          clientId: CLIENT_ID,
          deletedAt: "2026-09-15T10:00:00.000Z",
        },
        {
          id: "bbbbbbbb-1000-4000-8000-000000000009",
          clientId: null,
          deletedAt: "2026-09-15T10:00:00.000Z",
        },
      ],
    });
    const tombCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes(TOMBSTONE_SQL),
    );
    expect(String(tombCall?.[0])).toContain("deleted_at > $2");
    expect(tombCall?.[1]).toEqual([
      USER_ID,
      new Date("2026-09-01T00:00:00.000Z"),
    ]);
  });

  it("GET /training-sessions/history returns deleted: [] without updatedSince or on later pages", async () => {
    whenSqlContains({
      [TOMBSTONE_SQL]: {
        rows: [
          {
            session_id: SESSION_ID,
            client_id: OTHER_CLIENT_ID,
            deleted_at: new Date(),
          },
        ],
      },
      "FROM training_sessions": { rows: [] },
    });
    const cursor = Buffer.from(
      JSON.stringify({ startedAt: "2026-05-12T10:00:00.000Z", id: SESSION_ID }),
      "utf8",
    ).toString("base64url");

    for (const path of [
      "/training-sessions/history",
      `/training-sessions/history?cursor=${cursor}&updatedSince=2026-01-01T00:00:00.000Z`,
    ]) {
      mockQuery.mockClear();
      const res = await request(app).get(path).set(authHeaders());
      expect(res.status).toBe(200);
      expect(res.body.deleted).toEqual([]);
      expect(sqlCalls().some((sql) => sql.includes(TOMBSTONE_SQL))).toBe(false);
    }
  });

  it("PUT /training-sessions/:id returns 404 when session is not owned", async () => {
    whenSqlContains({
      "UPDATE training_sessions": { rowCount: 0 },
    });

    const res = await request(app)
      .put(`/training-sessions/${SESSION_ID}`)
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
  });
});
