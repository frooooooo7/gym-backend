import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock db/pool before importing app ────────────────────────────────────────
// vi.hoisted ensures these variables are created before vi.mock runs (which
// is itself hoisted to the top of the file by Vitest's transform step).

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

// Import app AFTER the mock is registered.
const { createApp } = await import("../../app.js");

// ── Constants ────────────────────────────────────────────────────────────────

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_EMAIL = "tester@gym.com";
const EXERCISE_ID = "a1000000-0000-0000-0000-000000000001";

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeToken = (sub = USER_ID, email = USER_EMAIL) =>
  jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: "1h" });

const authHeaders = () => ({ Authorization: `Bearer ${makeToken()}` });

const makeExerciseRow = (overrides: Record<string, unknown> = {}) => ({
  id: EXERCISE_ID,
  name: "Wyciskanie sztangi na ławce",
  muscles: ["chest", "triceps"],
  category: "compound",
  created_by: null,
  is_favourite: false,
  ...overrides,
});

const app = createApp();

// ── GET /exercises ────────────────────────────────────────────────────────────

describe("GET /exercises", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app).get("/exercises");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthorized" });
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get("/exercises")
      .set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "invalid_token" });
  });

  it("returns 400 when filter param is invalid", async () => {
    const res = await request(app)
      .get("/exercises?filter=unknown")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("returns 400 when muscle param is invalid", async () => {
    const res = await request(app)
      .get("/exercises?muscle=fantasy_muscle")
      .set(authHeaders());
    expect(res.status).toBe(400);
  });

  it("returns empty array when no exercises exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/exercises").set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("maps database rows to API shape", async () => {
    const row = makeExerciseRow({ is_favourite: true });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).get("/exercises").set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toStrictEqual({
      id: EXERCISE_ID,
      name: "Wyciskanie sztangi na ławce",
      muscles: ["chest", "triceps"],
      category: "compound",
      isFavourite: true,
      isMine: false,
    });
  });

  it("sets isMine=true when created_by matches the authenticated user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeExerciseRow({ created_by: USER_ID })],
    });
    const res = await request(app).get("/exercises").set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body[0].isMine).toBe(true);
  });

  it("returns multiple exercises sorted by name", async () => {
    const rows = [
      makeExerciseRow({ id: "id-1", name: "Ćwiczenie A" }),
      makeExerciseRow({ id: "id-2", name: "Ćwiczenie B" }),
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const res = await request(app).get("/exercises").set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns 503 when database is unavailable", async () => {
    mockGetPool.mockReturnValueOnce(null);

    const res = await request(app).get("/exercises").set(authHeaders());
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "database_unavailable" });
  });
});

// ── POST /exercises ───────────────────────────────────────────────────────────

describe("POST /exercises", () => {
  beforeEach(() => mockQuery.mockReset());

  const validBody = {
    name: "Moje ćwiczenie",
    muscles: ["biceps"],
    category: "isolation",
  };

  it("returns 401 when no token", async () => {
    const res = await request(app).post("/exercises").send(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/exercises")
      .set(authHeaders())
      .send({ muscles: ["abs"], category: "isolation" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when muscles array is empty", async () => {
    const res = await request(app)
      .post("/exercises")
      .set(authHeaders())
      .send({ name: "Test", muscles: [], category: "isolation" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when category is invalid", async () => {
    const res = await request(app)
      .post("/exercises")
      .set(authHeaders())
      .send({ name: "Test", muscles: ["abs"], category: "no_such_category" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when muscles contain invalid value", async () => {
    const res = await request(app)
      .post("/exercises")
      .set(authHeaders())
      .send({ name: "Test", muscles: ["fantasy_muscle"], category: "cardio" });
    expect(res.status).toBe(400);
  });

  it("creates exercise and returns 201 with isMine=true", async () => {
    const row = makeExerciseRow({
      created_by: USER_ID,
      name: "Moje ćwiczenie",
    });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app)
      .post("/exercises")
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Moje ćwiczenie",
      isMine: true,
      isFavourite: false,
    });
  });

  it("trims whitespace from name", async () => {
    const row = makeExerciseRow({ created_by: USER_ID, name: "Trimmed" });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app)
      .post("/exercises")
      .set(authHeaders())
      .send({ ...validBody, name: "  Trimmed  " });

    expect(res.status).toBe(201);
    // The Zod schema trims the name before inserting
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect((params as string[])[0]).toBe("Trimmed");
  });
});

// ── PUT /exercises/:id ────────────────────────────────────────────────────────

describe("PUT /exercises/:id", () => {
  beforeEach(() => mockQuery.mockReset());

  const validBody = {
    name: "Zaktualizowane",
    muscles: ["back"],
    category: "compound",
  };

  it("returns 401 when no token", async () => {
    const res = await request(app)
      .put(`/exercises/${EXERCISE_ID}`)
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid", async () => {
    const res = await request(app)
      .put(`/exercises/${EXERCISE_ID}`)
      .set(authHeaders())
      .send({ name: "OK" }); // missing muscles and category
    expect(res.status).toBe(400);
  });

  it("returns 404 when exercise does not exist or is not owned", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE returned no rows

    const res = await request(app)
      .put(`/exercises/${EXERCISE_ID}`)
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
  });

  it("returns 200 with updated exercise", async () => {
    const updatedRow = makeExerciseRow({
      created_by: USER_ID,
      name: "Zaktualizowane",
      muscles: ["back"],
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // favourite check

    const res = await request(app)
      .put(`/exercises/${EXERCISE_ID}`)
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Zaktualizowane");
    expect(res.body.muscles).toEqual(["back"]);
    expect(res.body.isMine).toBe(true);
    expect(res.body.isFavourite).toBe(false);
  });

  it("reflects existing favourite status after update", async () => {
    const updatedRow = makeExerciseRow({ created_by: USER_ID });
    mockQuery
      .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // favourite exists

    const res = await request(app)
      .put(`/exercises/${EXERCISE_ID}`)
      .set(authHeaders())
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.isFavourite).toBe(true);
  });
});

// ── DELETE /exercises/:id ─────────────────────────────────────────────────────

describe("DELETE /exercises/:id", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns 401 when no token", async () => {
    const res = await request(app).delete(`/exercises/${EXERCISE_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when exercise does not exist or is not owned", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app)
      .delete(`/exercises/${EXERCISE_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found_or_not_yours" });
  });

  it("returns 204 and empty body on successful delete", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .delete(`/exercises/${EXERCISE_ID}`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });
});

// ── POST /exercises/:id/favourite ─────────────────────────────────────────────

describe("POST /exercises/:id/favourite", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns 401 when no token", async () => {
    const res = await request(app).post(
      `/exercises/${EXERCISE_ID}/favourite`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when exercise does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // exercise check

    const res = await request(app)
      .post(`/exercises/${EXERCISE_ID}/favourite`)
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "exercise_not_found" });
  });

  it("adds favourite and returns isFavourite=true", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: EXERCISE_ID }] }) // exercise exists
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT succeeded

    const res = await request(app)
      .post(`/exercises/${EXERCISE_ID}/favourite`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      exerciseId: EXERCISE_ID,
      isFavourite: true,
    });
  });

  it("removes favourite and returns isFavourite=false", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: EXERCISE_ID }] }) // exercise exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT conflict (already exists)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

    const res = await request(app)
      .post(`/exercises/${EXERCISE_ID}/favourite`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      exerciseId: EXERCISE_ID,
      isFavourite: false,
    });
  });
});
