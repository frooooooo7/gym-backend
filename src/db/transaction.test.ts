import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { rollbackQuietly } from "./transaction.js";

describe("rollbackQuietly", () => {
  it("returns undefined after a successful ROLLBACK", async () => {
    const query = vi.fn().mockResolvedValue({});
    await expect(rollbackQuietly({ query } as unknown as PoolClient)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("swallows a failing ROLLBACK and returns its error for client.release()", async () => {
    const broken = new Error("Connection terminated");
    const query = vi.fn().mockRejectedValue(broken);
    await expect(rollbackQuietly({ query } as unknown as PoolClient)).resolves.toBe(broken);
  });
});
