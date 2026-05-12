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
          rowCount: result.rowCount ?? (result.rows?.length ?? 0),
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
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: SESSION_ID,
      clientId: CLIENT_ID,
      planName: "FBW",
      status: "completed",
      exercises: [
        {
          exerciseName: "Bench",
          sets: [{ actualWeight: "62.5", completed: true }],
        },
      ],
    });
    expect(mockRelease).toHaveBeenCalledOnce();
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
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: SESSION_ID,
      status: "completed",
    });
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
