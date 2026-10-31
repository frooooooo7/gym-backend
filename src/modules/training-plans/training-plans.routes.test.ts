import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tinyImage } from "../../test/images.js";

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

  describe("rest, supersets and plan look", () => {
    const stub = (plan: Record<string, unknown> = {}, exercise: Record<string, unknown> = {}) =>
      whenSqlContains({
        "SELECT id FROM exercises": { rows: [{ id: EXERCISE_ID }] },
        "INSERT INTO training_plans": { rows: [{ id: PLAN_ID, inserted: true }] },
        "FROM training_plans": { rows: [{ ...planRow, ...plan }] },
        "FROM training_plan_exercises": { rows: [{ ...planExerciseRow, ...exercise }] },
        "FROM training_plan_sets": { rows: [setRow] },
      });

    const paramsOf = (needle: string) =>
      mockQuery.mock.calls.find((call) => String(call[0]).includes(needle))?.[1] as unknown[];

    it("stores and returns rest per exercise, superset groups and plan settings", async () => {
      stub(
        {
          default_rest_seconds: 90,
          color_key: "sky",
          icon_key: "bolt",
          goal: "strength",
          progression_step_kg: "1.25",
          highlight_plan_color: false,
          show_rir: true,
          show_tempo: false,
          progression: { method: "double", unit: "kg", step: 2 },
        },
        { rest_seconds: 180, superset_group: "A" },
      );

      const res = await request(app)
        .post("/training-plans")
        .set(authHeaders())
        .send({
          ...validBody,
          defaultRestSeconds: 90,
          colorKey: "sky",
          iconKey: "bolt",
          goal: "strength",
          progressionStepKg: 1.25,
          highlightPlanColor: false,
          showTempo: false,
          progression: { method: "double", step: 2 },
          exercises: [{ ...validBody.exercises[0], restSeconds: 180, supersetGroup: "A" }],
        });

      expect(res.status).toBe(201);
      expect(paramsOf("INSERT INTO training_plans").slice(5)).toEqual([
        90, "sky", "bolt", "strength", 1.25, false, true, false, null, true,
        JSON.stringify({
          method: "double",
          unit: "kg",
          step: 2,
          legStep: null,
          percent: 2.5,
          rirThreshold: 2,
          sessionsToIncrease: 1,
          deload: false,
        }),
      ]);
      expect(paramsOf("INSERT INTO training_plan_exercises").slice(5)).toEqual([180, "A"]);
      expect(res.body).toMatchObject({
        defaultRestSeconds: 90,
        colorKey: "sky",
        iconKey: "bolt",
        goal: "strength",
        progressionStepKg: 1.25,
        highlightPlanColor: false,
        showRir: true,
        showTempo: false,
        progression: { method: "double", unit: "kg", step: 2, sessionsToIncrease: 1 },
      });
      expect(res.body.exercises[0]).toMatchObject({ restSeconds: 180, supersetGroup: "A" });
    });

    it("applies the defaults when an older client sends none of the new fields", async () => {
      stub({
        default_rest_seconds: 120,
        color_key: null,
        icon_key: null,
        goal: null,
        progression_step_kg: null,
        highlight_plan_color: true,
        show_rir: true,
        show_tempo: true,
      });

      const res = await request(app).post("/training-plans").set(authHeaders()).send(validBody);

      expect(res.status).toBe(201);
      expect(paramsOf("INSERT INTO training_plans").slice(5)).toEqual([
        120, null, null, null, null, true, true, true, null, false, null,
      ]);
      expect(paramsOf("INSERT INTO training_plan_exercises").slice(5)).toEqual([null, null]);
      expect(res.body.progressionStepKg).toBeNull();
      expect(res.body.progression).toBeNull();
    });

    it.each([
      [{ defaultRestSeconds: 1801 }, "invalid_rest_seconds"],
      [{ colorKey: "Sky Blue" }, "invalid_color_key"],
      [{ iconKey: "<svg>" }, "invalid_icon_key"],
      [{ progressionStepKg: 0 }, "invalid_progression_step"],
      [{ progression: { method: "magic" } }, "invalid_progression_method"],
      [{ progression: { method: "fixed", step: 0 } }, "invalid_progression_step"],
      [{ exercises: [{ ...validBody.exercises[0], supersetGroup: "AB" }] }, "invalid_superset_group"],
      [{ exercises: [{ ...validBody.exercises[0], restSeconds: -5 }] }, "invalid_rest_seconds"],
    ])("rejects %j with %s", async (patch, error) => {
      const res = await request(app)
        .post("/training-plans")
        .set(authHeaders())
        .send({ ...validBody, ...patch });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
    });
  });

  describe("plan sharing", () => {
    const AUTHOR_ID = "aaaaaaaa-0000-0000-0000-000000000002";
    const COPY_ID = "bbbbbbbb-0000-4000-8000-000000000009";
    const sourceRow = {
      ...planRow,
      user_id: AUTHOR_ID,
      is_public: true,
      copy_count: 11,
      copied_from_user_id: null,
    };
    const copyRow = {
      ...planRow,
      id: COPY_ID,
      is_public: false,
      copy_count: 0,
      copied_from_plan_id: PLAN_ID,
      copied_from_user_id: AUTHOR_ID,
      copied_from_handle: "anna",
    };
    const paramsOf = (needle: string) =>
      mockQuery.mock.calls.find((call) => String(call[0]).includes(needle))?.[1] as unknown[];
    const sqlCalls = () => mockQuery.mock.calls.map((call) => String(call[0]));

    it("copies a public plan as a private plan without the author's weights", async () => {
      whenSqlContains({
        "AND (is_public = true OR user_id = $2)": { rows: [sourceRow] },
        "JOIN exercises e": { rows: [planExerciseRow] },
        "FROM training_plan_sets": { rows: [setRow] },
        "SELECT id FROM training_plans WHERE user_id = $1 AND client_id": { rows: [] },
        "SELECT id FROM exercises": { rows: [{ id: EXERCISE_ID }] },
        "INSERT INTO training_plans": { rows: [{ id: COPY_ID }] },
        "WHERE id = $1 AND user_id = $2": { rows: [copyRow] },
      });

      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/copy`)
        .set(authHeaders())
        .send({ clientId: CLIENT_ID });

      expect(res.status).toBe(201);
      // Kopia: prywatna, z autorem i bez jego ciężarów.
      expect(paramsOf("INSERT INTO training_plans").slice(-3, -1)).toEqual([PLAN_ID, AUTHOR_ID]);
      expect(paramsOf("INSERT INTO training_plan_sets")[3]).toBeNull();
      expect(paramsOf("SET copy_count = copy_count + 1")).toEqual([PLAN_ID]);
      expect(res.body).toMatchObject({
        id: COPY_ID,
        isPublic: false,
        copiedFrom: { planId: PLAN_ID, userId: AUTHOR_ID, handle: "anna" },
        skippedExercises: 0,
      });
    });

    it("returns the existing copy for a repeated clientId", async () => {
      whenSqlContains({
        "AND (is_public = true OR user_id = $2)": { rows: [sourceRow] },
        "SELECT id FROM training_plans WHERE user_id = $1 AND client_id": {
          rows: [{ id: COPY_ID }],
        },
        "JOIN exercises e": { rows: [planExerciseRow] },
        "FROM training_plan_sets": { rows: [setRow] },
        "WHERE id = $1 AND user_id = $2": { rows: [copyRow] },
      });

      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/copy`)
        .set(authHeaders())
        .send({ clientId: CLIENT_ID });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(COPY_ID);
      expect(sqlCalls().some((sql) => sql.includes("INSERT INTO training_plans"))).toBe(false);
      expect(sqlCalls().some((sql) => sql.includes("copy_count + 1"))).toBe(false);
    });

    it("does not copy a private plan of someone else", async () => {
      whenSqlContains({});

      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/copy`)
        .set(authHeaders())
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("plan_not_found");
    });

    it("skips exercises the copier cannot see and refuses when none are left", async () => {
      whenSqlContains({
        "AND (is_public = true OR user_id = $2)": { rows: [sourceRow] },
        "JOIN exercises e": { rows: [planExerciseRow] },
        "FROM training_plan_sets": { rows: [setRow] },
        "SELECT id FROM exercises": { rows: [] },
      });

      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/copy`)
        .set(authHeaders())
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("no_copyable_exercises");
      expect(sqlCalls()).toContain("ROLLBACK");
    });

    it("lists someone's public plans without weights", async () => {
      whenSqlContains({
        "SELECT 1 FROM users WHERE id": { rows: [{ "?column?": 1 }] },
        "AND (is_public = true OR user_id = $2)": { rows: [sourceRow] },
        "JOIN exercises e": { rows: [planExerciseRow] },
        "FROM training_plan_sets": { rows: [setRow] },
      });

      const res = await request(app)
        .get(`/users/${AUTHOR_ID}/plans`)
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ isPublic: true, copyCount: 11 });
      expect(res.body[0].exercises[0].sets[0]).toMatchObject({ weight: null, reps: "8" });
    });

    it("keeps the stored visibility when an older client omits isPublic", async () => {
      whenSqlContains({
        "SELECT id FROM exercises": { rows: [{ id: EXERCISE_ID }] },
        "UPDATE training_plans": { rows: [], rowCount: 1 },
        "WHERE id = $1 AND user_id = $2": { rows: [{ ...planRow, is_public: true }] },
      });

      const res = await request(app)
        .put(`/training-plans/${PLAN_ID}`)
        .set(authHeaders())
        .send(validBody);

      expect(res.status).toBe(200);
      expect(paramsOf("UPDATE training_plans").at(-1)).toBeNull();
      expect(res.body.isPublic).toBe(true);
    });
  });

  describe("cover and sort order", () => {
    const COVERS_DIR = path.join(process.cwd(), "uploads", "plan-covers");

    const fileExists = async (p: string) =>
      fs.access(p).then(
        () => true,
        () => false,
      );

    /** Echo the new cover_url back like Postgres would. */
    const mockCoverUpdate = (previousUrl: string | null, found = true) => {
      let stored: string | null = null;
      mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes("SELECT cover_url FROM training_plans")) {
          return Promise.resolve({
            rows: found ? [{ cover_url: previousUrl }] : [],
            rowCount: found ? 1 : 0,
          });
        }
        if (text.includes("SET cover_url = $1")) {
          stored = (params?.[0] as string | null) ?? null;
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (text.includes("FROM training_plan_exercises")) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (text.includes("FROM training_plans")) {
          return Promise.resolve({
            rows: [{ ...planRow, cover_url: stored }],
            rowCount: 1,
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
    };

    it("POST /cover stores a WebP, swaps the previous file and serves it", async () => {
      await fs.mkdir(COVERS_DIR, { recursive: true });
      const previousName = `test-previous-${Date.now()}.webp`;
      const previousPath = path.join(COVERS_DIR, previousName);
      await fs.writeFile(previousPath, "old");
      mockCoverUpdate(`/uploads/plan-covers/${previousName}`);

      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/cover`)
        .set(authHeaders())
        .attach("photo", await tinyImage("jpeg", 2400), {
          filename: "cover.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(200);
      expect(res.body.coverUrl).toMatch(
        /^\/uploads\/plan-covers\/[0-9a-f-]{36}\.webp$/,
      );
      const storedPath = path.join(
        COVERS_DIR,
        path.basename(res.body.coverUrl as string),
      );
      try {
        expect(await fileExists(storedPath)).toBe(true);
        expect(await fileExists(previousPath)).toBe(false);
        const meta = await sharp(await fs.readFile(storedPath)).metadata();
        expect(meta.format).toBe("webp");
        expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600);
        const served = await request(app).get(res.body.coverUrl as string);
        expect(served.status).toBe(200);
      } finally {
        await fs.rm(storedPath, { force: true });
        await fs.rm(previousPath, { force: true });
      }
    });

    it("POST /cover returns 404 and keeps nothing on disk for someone else's plan", async () => {
      await fs.mkdir(COVERS_DIR, { recursive: true });
      const before = new Set(await fs.readdir(COVERS_DIR));
      mockCoverUpdate(null, false);

      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/cover`)
        .set(authHeaders())
        .attach("photo", await tinyImage("png", 64), {
          filename: "cover.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(404);
      const after = await fs.readdir(COVERS_DIR);
      expect(after.filter((name) => !before.has(name))).toEqual([]);
    });

    it("POST /cover rejects a request without a file", async () => {
      mockCoverUpdate(null);
      const res = await request(app)
        .post(`/training-plans/${PLAN_ID}/cover`)
        .set(authHeaders());
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "missing_image" });
    });

    it("DELETE /cover clears the cover and removes the file", async () => {
      await fs.mkdir(COVERS_DIR, { recursive: true });
      const previousName = `test-delete-${Date.now()}.webp`;
      const previousPath = path.join(COVERS_DIR, previousName);
      await fs.writeFile(previousPath, "old");
      mockCoverUpdate(`/uploads/plan-covers/${previousName}`);

      const res = await request(app)
        .delete(`/training-plans/${PLAN_ID}/cover`)
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body.coverUrl).toBeNull();
      expect(await fileExists(previousPath)).toBe(false);
    });

    it("DELETE /training-plans/:id removes the cover file", async () => {
      await fs.mkdir(COVERS_DIR, { recursive: true });
      const name = `test-plan-delete-${Date.now()}.webp`;
      const filePath = path.join(COVERS_DIR, name);
      await fs.writeFile(filePath, "old");
      mockQuery.mockResolvedValueOnce({
        rows: [{ cover_url: `/uploads/plan-covers/${name}` }],
        rowCount: 1,
      });

      const res = await request(app)
        .delete(`/training-plans/${PLAN_ID}`)
        .set(authHeaders());

      expect(res.status).toBe(204);
      expect(await fileExists(filePath)).toBe(false);
    });

    it("PUT stores sortOrder and returns it with the cover", async () => {
      whenSqlContains({
        "SELECT id FROM exercises": { rows: [{ id: EXERCISE_ID }] },
        "UPDATE training_plans": { rows: [], rowCount: 1 },
        "WHERE id = $1 AND user_id = $2": {
          rows: [{ ...planRow, sort_order: 2, cover_url: "/uploads/plan-covers/x.webp" }],
        },
      });

      const res = await request(app)
        .put(`/training-plans/${PLAN_ID}`)
        .set(authHeaders())
        .send({ ...validBody, sortOrder: 2 });

      expect(res.status).toBe(200);
      const sortCall = mockQuery.mock.calls.find((call) =>
        String(call[0]).includes("SET sort_order = $1"),
      );
      expect(sortCall?.[1]).toEqual([2, PLAN_ID]);
      expect(res.body).toMatchObject({
        sortOrder: 2,
        coverUrl: "/uploads/plan-covers/x.webp",
      });
    });

    it("PUT leaves the position alone when an older client omits sortOrder", async () => {
      whenSqlContains({
        "SELECT id FROM exercises": { rows: [{ id: EXERCISE_ID }] },
        "UPDATE training_plans": { rows: [], rowCount: 1 },
        "WHERE id = $1 AND user_id = $2": { rows: [planRow] },
      });

      const res = await request(app)
        .put(`/training-plans/${PLAN_ID}`)
        .set(authHeaders())
        .send(validBody);

      expect(res.status).toBe(200);
      expect(
        mockQuery.mock.calls.some((call) =>
          String(call[0]).includes("SET sort_order = $1"),
        ),
      ).toBe(false);
    });
  });
});
