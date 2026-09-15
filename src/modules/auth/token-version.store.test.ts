import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared setup file mocks this module for route tests — test the real one.
vi.unmock("./token-version.store.js");

const { mockFindTokenVersion } = vi.hoisted(() => ({
  mockFindTokenVersion: vi.fn<(id: string) => Promise<number | null>>(),
}));

vi.mock("./auth.repository.js", () => ({
  authRepository: { findTokenVersion: mockFindTokenVersion },
}));

const store = await import("./token-version.store.js");

const USER = "aaaaaaaa-0000-0000-0000-000000000001";

describe("token-version store", () => {
  beforeEach(() => {
    store.clearTokenVersionCache();
    mockFindTokenVersion.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the version from the repository and caches it", async () => {
    mockFindTokenVersion.mockResolvedValue(3);
    expect(await store.getTokenVersion(USER)).toBe(3);
    expect(await store.getTokenVersion(USER)).toBe(3);
    expect(mockFindTokenVersion).toHaveBeenCalledTimes(1);
  });

  it("caches a missing user as null", async () => {
    mockFindTokenVersion.mockResolvedValue(null);
    expect(await store.getTokenVersion(USER)).toBeNull();
    expect(await store.isTokenVersionCurrent(USER, 0)).toBe(false);
    expect(mockFindTokenVersion).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the TTL expires", async () => {
    vi.useFakeTimers();
    mockFindTokenVersion.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await store.getTokenVersion(USER)).toBe(1);
    vi.advanceTimersByTime(store.TOKEN_VERSION_CACHE_TTL_MS - 1);
    expect(await store.getTokenVersion(USER)).toBe(1);
    vi.advanceTimersByTime(2);
    expect(await store.getTokenVersion(USER)).toBe(2);
    expect(mockFindTokenVersion).toHaveBeenCalledTimes(2);
  });

  it("isTokenVersionCurrent compares the token's version", async () => {
    mockFindTokenVersion.mockResolvedValue(2);
    expect(await store.isTokenVersionCurrent(USER, 2)).toBe(true);
    expect(await store.isTokenVersionCurrent(USER, 1)).toBe(false);
    expect(await store.isTokenVersionCurrent(USER, 0)).toBe(false);
  });

  it("primeTokenVersion takes effect immediately without a DB read", async () => {
    mockFindTokenVersion.mockResolvedValue(0);
    expect(await store.isTokenVersionCurrent(USER, 0)).toBe(true);
    store.primeTokenVersion(USER, 1);
    expect(await store.isTokenVersionCurrent(USER, 0)).toBe(false);
    expect(await store.isTokenVersionCurrent(USER, 1)).toBe(true);
    store.primeTokenVersion(USER, null);
    expect(await store.isTokenVersionCurrent(USER, 1)).toBe(false);
    expect(mockFindTokenVersion).toHaveBeenCalledTimes(1);
  });

  it("invalidateTokenVersion forces a fresh read", async () => {
    mockFindTokenVersion.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    expect(await store.getTokenVersion(USER)).toBe(0);
    store.invalidateTokenVersion(USER);
    expect(await store.getTokenVersion(USER)).toBe(4);
  });

  it("an in-flight lookup does not overwrite a newer prime", async () => {
    let resolveLookup!: (v: number) => void;
    mockFindTokenVersion.mockImplementationOnce(
      () => new Promise<number>((resolve) => (resolveLookup = resolve)),
    );
    const pending = store.getTokenVersion(USER);
    store.primeTokenVersion(USER, 5);
    resolveLookup(4); // stale value read before the bump
    expect(await pending).toBe(5);
    expect(await store.getTokenVersion(USER)).toBe(5);
    expect(mockFindTokenVersion).toHaveBeenCalledTimes(1);
  });

  it("propagates repository errors (callers fail closed) and caches nothing", async () => {
    mockFindTokenVersion
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(0);
    await expect(store.getTokenVersion(USER)).rejects.toThrow("connection refused");
    expect(await store.getTokenVersion(USER)).toBe(0);
  });

  it("is bounded — the oldest entry is evicted first", async () => {
    const max = store.TOKEN_VERSION_CACHE_MAX_ENTRIES;
    store.primeTokenVersion("first", 7);
    for (let i = 0; i < max; i++) store.primeTokenVersion(`user-${i}`, 0);
    mockFindTokenVersion.mockResolvedValue(9);
    expect(await store.getTokenVersion(`user-${max - 1}`)).toBe(0);
    expect(mockFindTokenVersion).not.toHaveBeenCalled();
    expect(await store.getTokenVersion("first")).toBe(9);
    expect(mockFindTokenVersion).toHaveBeenCalledWith("first");
  });
});
