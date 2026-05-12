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
const PLAN_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const PLAN_EXERCISE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const SET_ID = "bbbbbbbb-0000-4000-8000-000000000003";
const EXERCISE_ID = "a1000000-0000-0000-0000-000000000001";
const CLIENT_ID = "550e8400-e29b-41d4-a716-446655440000";

const makeToken = (sub = USER_ID, email = USER_EMAIL) =>
  jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: "1h" });

const authHeaders = () => ({ Authorization: `Bearer ${makeToken()}` });

const app = createApp();

const validBody = {
  clientId: CLIENT_ID,
  name: "FBW",
  note: "3 dni",
  selectedDays: [3, 1, 3],
  exercises: [
    {
      clientId: "550e8400-e29b-41d4-a716-446655440001",
      exerciseId: EXERCISE_ID,
      sets: [
        {
          clientId: "550e8400-e29b-41d4-a716-446655440002",
          weight: "60",
          reps: "8",
        },
      ],
    },
  ],
};

const planRow = {
  id: PLAN_ID,
  client_id: CLIENT_ID,
  user_id: USER_ID,
  name: "FBW",
  note: "3 dni",
  selected_days: [1, 3],
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-01-02T00:00:00Z"),
};

const planExerciseRow = {
  id: PLAN_EXERCISE_ID,
  client_id: "550e8400-e29b-41d4-a716-446655440001",
  plan_id: PLAN_ID,
  exercise_id: EXERCISE_ID,
  position: 0,
  exercise_name: "Bench",
  exercise_muscles: ["chest"],
  exercise_category: "compound",
  exercise_description: "",
  exercise_image_url: null,
};

const setRow = {
  id: SET_ID,
  client_id: "550e8400-e29b-41d4-a716-446655440002",
  plan_exercise_id: PLAN_EXERCISE_ID,
  position: 0,
  weight: "60",
  reps: "8",
  rir: null,
  tempo: null,
};

/**
 * Helper: given a SQL snippet, returns a function that responds
 * with the provided rows. This decouples tests from exact query ordering.
 */
const whenSqlContains = (patterns: Record<string, { rows?: unknown[]; rowCount?: number }>) => {
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
    // Default: BEGIN / COMMIT / ROLLBACK / other
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

describe("training plans routes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockClear();
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
  });

  it("GET /training-plans returns 401 without auth", async () => {
    const res = await request(app).get("/training-plans");
    expect(res.status).toBe(401);
  });

  it("POST /training-plans returns 400 for invalid body", async () => {
    const res = await request(app)
      .post("/training-plans")
      .set(authHeaders())
      .send({ name: "", exercises: [] });

    expect(res.status).toBe(400);
  });

  it("POST /training-plans returns 400 for whitespace-only name", async () => {
    const res = await request(app)
      .post("/training-plans")
      .set(authHeaders())
      .send({ ...validBody, name: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "missing_name" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /training-plans returns 503 when the main database is unavailable", async () => {
    mockGetPool.mockReturnValueOnce(null);

    const res = await request(app)
      .post("/training-plans")
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "database_unavailable" });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("PUT /training-plans/:id returns 400 for invalid id", async () => {
    const res = await request(app)
      .put("/training-plans/not-a-uuid")
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_id" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("DELETE /training-plans/:id returns 400 for invalid id", async () => {
    const res = await request(app)
      .delete("/training-plans/not-a-uuid")
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_id" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /training-plans returns nested exercises and sets in API shape", async () => {
    whenSqlContains({
      "FROM training_plans": { rows: [planRow] },
      "FROM training_plan_exercises": { rows: [planExerciseRow] },
      "FROM training_plan_sets": { rows: [setRow] },
    });

    const res = await request(app).get("/training-plans").set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: PLAN_ID,
      clientId: CLIENT_ID,
      name: "FBW",
      selectedDays: [1, 3],
      exercises: [
        {
          id: PLAN_EXERCISE_ID,
          exerciseId: EXERCISE_ID,
          exercise: { name: "Bench", muscles: ["chest"] },
          sets: [{ id: SET_ID, weight: "60", reps: "8" }],
        },
      ],
    });
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("POST /training-plans upserts by clientId and normalizes selectedDays", async () => {
    whenSqlContains({
      "SELECT id FROM exercises": { rows: [{ id: EXERCISE_ID }] },
      "INSERT INTO training_plans": { rows: [{ id: PLAN_ID, inserted: false }] },
      "DELETE FROM training_plan_exercises": { rows: [] },
      "INSERT INTO training_plan_exercises": { rows: [{ id: PLAN_EXERCISE_ID }] },
      "INSERT INTO training_plan_sets": { rows: [] },
      "FROM training_plans": { rows: [planRow] },
      "FROM training_plan_exercises": { rows: [planExerciseRow] },
      "FROM training_plan_sets": { rows: [setRow] },
    });

    const res = await request(app)
      .post("/training-plans")
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(PLAN_ID);
    // Verify selectedDays were deduplicated and sorted by checking the upsert call
    const upsertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_plans"),
    );
    expect(upsertCall?.[1]).toContainEqual([1, 3]);
  });

  it("DELETE /training-plans/:id returns 404 when not owned", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app)
      .delete(`/training-plans/${PLAN_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
  });
});
