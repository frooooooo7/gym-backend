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

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_EMAIL = "tester@gym.com";
const SESSION_ID = "f1000000-0000-4000-8000-000000000001";
const PLAN_ID = "f2000000-0000-4000-8000-000000000001";
const EXERCISE_ID = "a1000000-0000-0000-0000-000000000001";

const makeToken = (sub = USER_ID, email = USER_EMAIL) =>
  jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: "1h" });

const authHeaders = () => ({ Authorization: `Bearer ${makeToken()}` });

const app = createApp();

const listRow = {
  id: SESSION_ID,
  started_at: new Date("2026-05-14T18:05:00Z"),
  ended_at: new Date("2026-05-14T19:02:00Z"),
  duration_sec: 3420,
  status: "completed",
  plan_id: PLAN_ID,
  plan_name: "Push/Pull/Legs",
  exercises_count: 6,
  completed_sets_count: 18,
  note: "Felt great",
  progress_type: "weight_increase",
  progress_label: "+5 kg bench",
  updated_at: new Date("2026-05-14T19:05:00Z"),
};

const detailSessionRow = {
  id: SESSION_ID,
  started_at: new Date("2026-05-14T18:05:00Z"),
  ended_at: new Date("2026-05-14T19:02:00Z"),
  duration_sec: 3420,
  status: "completed",
  plan_id: PLAN_ID,
  plan_name: "Push/Pull/Legs",
  note: "Felt great",
  updated_at: new Date("2026-05-14T19:05:00Z"),
};

const detailExerciseRow = {
  id: "f3000000-0000-4000-8000-000000000001",
  session_id: SESSION_ID,
  exercise_id: EXERCISE_ID,
  exercise_name: "Bench Press",
  position: 0,
};

const detailSetRow = {
  id: "f4000000-0000-4000-8000-000000000001",
  session_exercise_id: detailExerciseRow.id,
  set_index: 1,
  planned_weight_kg: "80",
  planned_reps: 8,
  planned_rir: 2,
  planned_tempo: "3010",
  actual_weight_kg: "82.5",
  actual_reps: 8,
  actual_rir: 1,
  actual_tempo: "3010",
  completed: true,
};

describe("training history routes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
  });

  it("GET /api/v1/training-history returns 401 without auth", async () => {
    const res = await request(app).get("/api/v1/training-history");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthorized" });
  });

  it("GET /api/v1/training-history returns 400 for invalid query", async () => {
    const res = await request(app)
      .get("/api/v1/training-history?limit=1000")
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_limit" });
  });

  it("GET /api/v1/training-history returns paginated rows in API shape", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [listRow] });

    const res = await request(app)
      .get("/api/v1/training-history?limit=20")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeTruthy();
    expect(res.body).toMatchObject({
      items: [
        {
          id: SESSION_ID,
          status: "completed",
          durationSec: 3420,
          plan: { id: PLAN_ID, name: "Push/Pull/Legs" },
          exercisesCount: 6,
          completedSetsCount: 18,
          hasNote: true,
          progressHighlight: {
            type: "weight_increase",
            label: "+5 kg bench",
          },
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("GET /api/v1/training-sessions keeps the legacy history page endpoint working", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [listRow] });

    const res = await request(app)
      .get("/api/v1/training-sessions?limit=20")
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: [
        {
          id: SESSION_ID,
          status: "completed",
          plan: { id: PLAN_ID, name: "Push/Pull/Legs" },
        },
      ],
    });
  });

  it("GET /api/v1/training-history returns 304 with matching If-None-Match", async () => {
    mockQuery.mockResolvedValue({ rows: [listRow] });

    const first = await request(app)
      .get("/api/v1/training-history?limit=20")
      .set(authHeaders());
    const etag = first.headers.etag as string;
    expect(first.status).toBe(200);

    const second = await request(app)
      .get("/api/v1/training-history?limit=20")
      .set(authHeaders())
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("GET /api/v1/training-history/:sessionId returns 400 for invalid id", async () => {
    const res = await request(app)
      .get("/api/v1/training-history/not-a-uuid")
      .set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_session_id" });
  });

  it("GET /api/v1/training-history/:sessionId returns 404 when missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get(`/api/v1/training-history/${SESSION_ID}`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
  });

  it("GET /api/v1/training-history/:sessionId returns detail in API shape", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [detailSessionRow] })
      .mockResolvedValueOnce({ rows: [detailExerciseRow] })
      .mockResolvedValueOnce({ rows: [detailSetRow] });

    const res = await request(app)
      .get(`/api/v1/training-history/${SESSION_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeTruthy();
    expect(res.body).toMatchObject({
      id: SESSION_ID,
      durationSec: 3420,
      status: "completed",
      plan: { id: PLAN_ID, name: "Push/Pull/Legs" },
      note: "Felt great",
      exercises: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Bench Press",
          sets: [
            {
              setIndex: 1,
              planned: { weightKg: 80, reps: 8, rir: 2, tempo: "3010" },
              actual: { weightKg: 82.5, reps: 8, rir: 1, tempo: "3010" },
              completed: true,
            },
          ],
        },
      ],
    });
  });

  it("GET /api/v1/training-history/:sessionId returns 304 with matching If-None-Match", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [detailSessionRow] })
      .mockResolvedValueOnce({ rows: [detailExerciseRow] })
      .mockResolvedValueOnce({ rows: [detailSetRow] })
      .mockResolvedValueOnce({ rows: [detailSessionRow] })
      .mockResolvedValueOnce({ rows: [detailExerciseRow] })
      .mockResolvedValueOnce({ rows: [detailSetRow] });

    const first = await request(app)
      .get(`/api/v1/training-history/${SESSION_ID}`)
      .set(authHeaders());
    const etag = first.headers.etag as string;
    expect(first.status).toBe(200);

    const second = await request(app)
      .get(`/api/v1/training-history/${SESSION_ID}`)
      .set(authHeaders())
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });
});
