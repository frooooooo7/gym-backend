import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockRelease, mockConnect } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn(() => ({
    query: mockQuery,
    release: mockRelease,
  }));
  return { mockQuery, mockRelease, mockConnect };
});

vi.mock("../../db/require-pool.js", () => ({
  requirePool: () => ({ connect: mockConnect }),
}));

const { trainingPlansRepository } = await import(
  "./training-plans.repository.js"
);

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PLAN_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const PLAN_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const PLAN_EXERCISE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAN_EXERCISE_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const SET_ID = "bbbbbbbb-0000-4000-8000-000000000003";
const SET_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440002";
const EXERCISE_ID = "a1000000-0000-0000-0000-000000000001";

const body = {
  clientId: PLAN_CLIENT_ID,
  name: "FBW",
  note: "3 dni",
  selectedDays: [1, 3],
  exercises: [
    {
      clientId: PLAN_EXERCISE_CLIENT_ID,
      exerciseId: EXERCISE_ID,
      sets: [
        {
          clientId: SET_CLIENT_ID,
          weight: "60",
          reps: "8",
        },
      ],
    },
  ],
};

const planRow = {
  id: PLAN_ID,
  client_id: PLAN_CLIENT_ID,
  user_id: USER_ID,
  name: "FBW",
  note: "3 dni",
  selected_days: [1, 3],
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-01-02T00:00:00Z"),
};

const planExerciseRow = {
  id: PLAN_EXERCISE_ID,
  client_id: PLAN_EXERCISE_CLIENT_ID,
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
  client_id: SET_CLIENT_ID,
  plan_exercise_id: PLAN_EXERCISE_ID,
  position: 0,
  weight: "60",
  reps: "8",
  rir: null,
  tempo: null,
};

const installSuccessfulUpsertMocks = (inserted: boolean) => {
  mockQuery.mockImplementation((sql: string) => {
    const sqlStr = String(sql);
    if (sqlStr === "BEGIN" || sqlStr === "COMMIT" || sqlStr === "ROLLBACK") {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sqlStr.includes("SELECT id FROM exercises")) {
      return Promise.resolve({ rows: [{ id: EXERCISE_ID }], rowCount: 1 });
    }
    if (sqlStr.includes("INSERT INTO training_plans")) {
      return Promise.resolve({
        rows: [{ id: PLAN_ID, inserted }],
        rowCount: 1,
      });
    }
    if (sqlStr.includes("DELETE FROM training_plan_exercises")) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sqlStr.includes("INSERT INTO training_plan_exercises")) {
      return Promise.resolve({ rows: [{ id: PLAN_EXERCISE_ID }], rowCount: 1 });
    }
    if (sqlStr.includes("INSERT INTO training_plan_sets")) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (
      sqlStr.includes("FROM training_plans") &&
      sqlStr.includes("WHERE id = $1 AND user_id = $2")
    ) {
      return Promise.resolve({ rows: [planRow], rowCount: 1 });
    }
    if (
      sqlStr.includes("FROM training_plan_exercises") &&
      sqlStr.includes("JOIN exercises")
    ) {
      return Promise.resolve({ rows: [planExerciseRow], rowCount: 1 });
    }
    if (sqlStr.includes("FROM training_plan_sets")) {
      return Promise.resolve({ rows: [setRow], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

const findQueryIndex = (needle: string) =>
  mockQuery.mock.calls.findIndex((call) => String(call[0]).includes(needle));

describe("trainingPlansRepository.upsert", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockClear();
  });

  it("uses clientId upsert so a synced local plan is idempotent per user", async () => {
    installSuccessfulUpsertMocks(false);

    const result = await trainingPlansRepository.upsert(USER_ID, body);

    expect(result.created).toBe(false);
    expect(result.row.id).toBe(PLAN_ID);

    const upsertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_plans"),
    );
    expect(String(upsertCall?.[0])).toContain(
      "ON CONFLICT (user_id, client_id)",
    );
    expect(String(upsertCall?.[0])).toContain("WHERE client_id IS NOT NULL");
    expect(String(upsertCall?.[0])).toContain("DO UPDATE SET");
    expect(upsertCall?.[1]).toEqual([
      USER_ID,
      PLAN_CLIENT_ID,
      "FBW",
      "3 dni",
      [1, 3],
    ]);

    expect(findQueryIndex("BEGIN")).toBeLessThan(
      findQueryIndex("INSERT INTO training_plans"),
    );
    expect(findQueryIndex("INSERT INTO training_plans")).toBeLessThan(
      findQueryIndex("DELETE FROM training_plan_exercises"),
    );
    expect(findQueryIndex("INSERT INTO training_plan_sets")).toBeLessThan(
      findQueryIndex("COMMIT"),
    );
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("stores local child identifiers while replacing synced children atomically", async () => {
    installSuccessfulUpsertMocks(true);

    await trainingPlansRepository.upsert(USER_ID, body);

    const deleteCallIndex = findQueryIndex("DELETE FROM training_plan_exercises");
    const childInsertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_plan_exercises"),
    );
    const setInsertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_plan_sets"),
    );

    expect(deleteCallIndex).toBeGreaterThan(-1);
    expect(childInsertCall?.[1]).toEqual([
      PLAN_EXERCISE_CLIENT_ID,
      PLAN_ID,
      EXERCISE_ID,
      0,
    ]);
    expect(setInsertCall?.[1]).toEqual([
      SET_CLIENT_ID,
      PLAN_EXERCISE_ID,
      0,
      "60",
      "8",
      null,
      null,
    ]);
  });

  it("uses a plain insert when clientId is missing, so sync callers must send clientId", async () => {
    installSuccessfulUpsertMocks(true);

    await trainingPlansRepository.upsert(USER_ID, {
      ...body,
      clientId: undefined,
    });

    const insertCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO training_plans"),
    );
    expect(String(insertCall?.[0])).not.toContain("ON CONFLICT");
    expect(String(insertCall?.[0])).not.toContain("client_id");
    expect(insertCall?.[1]).toEqual([USER_ID, "FBW", "3 dni", [1, 3]]);
  });

  it("rolls back without mutating plans when an exercise is not visible to the user", async () => {
    mockQuery.mockImplementation((sql: string) => {
      const sqlStr = String(sql);
      if (sqlStr === "BEGIN" || sqlStr === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sqlStr.includes("SELECT id FROM exercises")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(trainingPlansRepository.upsert(USER_ID, body)).rejects.toMatchObject({
      statusCode: 400,
      code: "exercise_not_found",
    });

    expect(findQueryIndex("INSERT INTO training_plans")).toBe(-1);
    expect(findQueryIndex("ROLLBACK")).toBeGreaterThan(
      findQueryIndex("SELECT id FROM exercises"),
    );
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
