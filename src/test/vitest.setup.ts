import { vi } from "vitest";

/**
 * Route tests mock `pool.query` with ordered/pattern responses and sign
 * tokens without a `tv` claim. requireAuth's token-version check would add a
 * DB query to every one of them, so it is mocked here once: by default every
 * token's version is current. Tests that exercise revocation either override
 * `isTokenVersionCurrent` via `vi.mocked(...)` or `vi.unmock` this module
 * (see token-version.store.test.ts / auth.routes.test.ts).
 */
vi.mock("../modules/auth/token-version.store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../modules/auth/token-version.store.js")>();
  return {
    ...actual,
    isTokenVersionCurrent: vi.fn(async () => true),
  };
});
