import { authRepository } from "./auth.repository.js";

/**
 * In-memory cache of `users.token_version`, consulted by `requireAuth` on
 * every authenticated request so revocation checks don't cost a DB round-trip
 * each time.
 *
 * - Entries live for {@link TTL_MS}; `null` caches "user does not exist".
 * - The cache is bounded ({@link MAX_ENTRIES}); the oldest entry is evicted
 *   first (Map iteration order = insertion order).
 * - Bumping the version (change-password, logout-all) or deleting the account
 *   primes the entry immediately, so revocation is instant **within this
 *   process**. With several API instances behind a load balancer, the other
 *   instances keep serving their cached version, so revocation propagates
 *   there within the TTL (≤ 30 s).
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

interface Entry {
  version: number | null;
  expiresAt: number;
  /** Monotonic write sequence — lets an in-flight DB lookup detect it lost a race with a prime. */
  seq: number;
}

const cache = new Map<string, Entry>();
let writeSeq = 0;

const store = (userId: string, version: number | null): void => {
  cache.delete(userId);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(userId, { version, expiresAt: Date.now() + TTL_MS, seq: ++writeSeq });
};

/**
 * Current token version of the user, or `null` when the user no longer exists.
 * Throws when the database is unavailable (callers must fail closed).
 */
export const getTokenVersion = async (userId: string): Promise<number | null> => {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.version;

  const startSeq = writeSeq;
  const version = await authRepository.findTokenVersion(userId);

  // A prime/invalidate for this user happened while we were querying — the
  // value we read may predate it, so don't overwrite the fresher entry.
  const latest = cache.get(userId);
  if (latest && latest.seq > startSeq) return latest.version;
  store(userId, version);
  return version;
};

/** `true` when a token carrying `tokenVersion` (missing claim = 0) is still valid. */
export const isTokenVersionCurrent = async (
  userId: string,
  tokenVersion: number,
): Promise<boolean> => {
  const current = await getTokenVersion(userId);
  return current !== null && current === tokenVersion;
};

/** Records a freshly bumped version (or `null` for a deleted user) immediately. */
export const primeTokenVersion = (userId: string, version: number | null): void => {
  store(userId, version);
};

/** Drops the cached entry so the next check reads the database. */
export const invalidateTokenVersion = (userId: string): void => {
  writeSeq++;
  cache.delete(userId);
};

/** Test helper. */
export const clearTokenVersionCache = (): void => {
  writeSeq++;
  cache.clear();
};

export const TOKEN_VERSION_CACHE_TTL_MS = TTL_MS;
export const TOKEN_VERSION_CACHE_MAX_ENTRIES = MAX_ENTRIES;
