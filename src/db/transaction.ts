import type { PoolClient } from "pg";

/**
 * `ROLLBACK` for a `catch` block. A failing rollback (typically a dropped
 * connection) must neither replace the original error nor return a broken
 * client to the pool, so it is swallowed and handed back: pass it to
 * `client.release(error)`, which destroys the connection instead of reusing it.
 */
export const rollbackQuietly = async (
  client: PoolClient,
): Promise<Error | undefined> => {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (e: unknown) {
    return e instanceof Error ? e : new Error(String(e));
  }
};
