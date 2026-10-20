import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockGetPool = vi.fn(() => ({ query: mockQuery }) as unknown as import("pg").Pool);
  return { mockQuery, mockGetPool };
});

vi.mock("../../db/pool.js", () => ({ getPool: mockGetPool }));

const { purgeOldTombstones, tombstoneRetentionDays } = await import("./tombstone-cleanup.js");

describe("tombstone cleanup", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it.each([
    [undefined, 365],
    ["", 365],
    ["abc", 365],
    ["-5", 365],
    ["0", 0],
    ["30", 30],
  ])("TOMBSTONE_RETENTION_DAYS=%j → %d days", (raw, expected) => {
    expect(tombstoneRetentionDays(raw)).toBe(expected);
  });

  it("deletes tombstones older than the window", async () => {
    mockQuery.mockResolvedValue({ rowCount: 7 });
    await expect(purgeOldTombstones(365)).resolves.toBe(7);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM training_session_tombstones");
    expect(sql).toContain("deleted_at < now() - make_interval(days => $1)");
    expect(params).toEqual([365]);
  });

  it("does nothing when disabled", async () => {
    await expect(purgeOldTombstones(0)).resolves.toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
