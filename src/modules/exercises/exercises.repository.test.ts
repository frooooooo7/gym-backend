import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();

vi.mock("../../db/require-pool.js", () => ({
  requirePool: () => ({ query: mockQuery }),
}));

const { exercisesRepository } = await import("./exercises.repository.js");

const baseListQuery = {
  q: "",
  muscle: "all" as const,
  filter: "all" as const,
  limit: 50,
  offset: 0,
};

describe("exercisesRepository.list", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("restricts rows to system exercises or those created by the requesting user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await exercisesRepository.list(
      "aaaaaaaa-0000-0000-0000-000000000099",
      baseListQuery,
    );
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain("e.is_system = true");
    expect(sql).toContain("e.created_by = $1");
  });

  it("does not mix visibility predicates across users (single user param for ownership)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const uid = "bbbbbbbb-0000-0000-0000-000000000088";
    await exercisesRepository.list(uid, baseListQuery);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(uid);
  });
});

describe("exercisesRepository.insertUserExercise", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const sharedRow = {
    id: "cccccccc-0000-0000-0000-000000000011",
    name: "Test",
    muscles: ["biceps"],
    category: "isolation",
    description: "",
    image_url: null,
    created_by: "aaaaaaaa-0000-0000-0000-000000000001",
    created_at: new Date(),
  };

  it("uses plain INSERT when clientId is omitted", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sharedRow] });
    await exercisesRepository.insertUserExercise(
      "Test",
      ["biceps"],
      "isolation",
      "",
      "aaaaaaaa-0000-0000-0000-000000000001",
      undefined,
    );
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain("INSERT INTO exercises");
    expect(sql).not.toContain("ON CONFLICT");
    expect(sql).not.toContain("client_id");
  });

  it("uses UPSERT when clientId is provided", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...sharedRow, inserted: true }],
    });
    await exercisesRepository.insertUserExercise(
      "Test",
      ["biceps"],
      "isolation",
      "",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "dddddddd-0000-0000-0000-000000000022",
    );
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain("ON CONFLICT (created_by, client_id)");
    expect(sql).toContain("WHERE client_id IS NOT NULL");
    expect(sql).toContain("DO UPDATE SET");
  });

  it("reports created=false after conflict update branch", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...sharedRow, inserted: false }],
    });
    const result = await exercisesRepository.insertUserExercise(
      "Updated",
      ["back"],
      "compound",
      "x",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "dddddddd-0000-0000-0000-000000000022",
    );
    expect(result.created).toBe(false);
    expect(result.row.id).toBe(sharedRow.id);
  });
});
