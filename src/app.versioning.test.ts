import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockConnect = vi.fn(async () => ({ query: mockQuery, release: vi.fn() }));
  const mockPool = { query: mockQuery, connect: mockConnect };
  const mockGetPool = vi.fn(
    (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
  );
  return { mockQuery, mockGetPool };
});

vi.mock("./db/pool.js", () => ({ getPool: mockGetPool }));

const { createApp } = await import("./app.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const SESSION_ID = "f1000000-0000-4000-8000-000000000001";
const token = jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET, {
  expiresIn: "1h",
});
const auth = { Authorization: `Bearer ${token}` };

const app = createApp();

type Method = "get" | "post" | "put" | "patch" | "delete";

const send = (method: Method, path: string, body?: unknown) => {
  const r = request(app)[method](path).set(auth);
  return body === undefined ? r : r.send(body as object);
};

const isRouteNotFound = (res: request.Response) =>
  res.status === 404 && res.body?.message === "Route not found";

beforeEach(() => {
  mockQuery.mockReset();
  // Empty result for every query: enough to reach each handler deterministically.
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetPool.mockClear();
});

describe("API versioning: every module answers on the legacy and the /api/v1 mount", () => {
  const cases: Array<[string, Method, string, unknown?]> = [
    ["health", "get", "/health"],
    ["auth", "get", "/auth/me"],
    ["auth (validation)", "post", "/auth/login", {}],
    ["exercises", "get", "/exercises"],
    ["training-plans", "get", "/training-plans"],
    ["training-plans (validation)", "post", "/training-plans", {}],
    ["training-sessions active", "get", "/training-sessions/active"],
    ["training-sessions history", "get", "/training-sessions/history"],
    ["training-sessions (validation)", "post", "/training-sessions", {}],
    ["training-sessions delete", "delete", "/training-sessions/not-a-uuid"],
    ["profile", "get", "/profile/following"],
    ["users", "get", `/users/${OTHER_ID}/followers`],
    ["users search", "get", "/users/search?q=ab"],
    ["users suggested", "get", "/users/suggested"],
    ["feed", "get", "/feed"],
    ["posts", "get", `/posts/${SESSION_ID}`],
    ["posts comments", "get", `/posts/${SESSION_ID}/comments`],
  ];

  it.each(cases)("%s: %s %s", async (_name, method, path, body) => {
    const legacy = await send(method, path, body);
    const v1 = await send(method, `/api/v1${path}`, body);

    expect(isRouteNotFound(legacy)).toBe(false);
    expect(isRouteNotFound(v1)).toBe(false);
    expect(v1.status).toBe(legacy.status);
    expect(v1.body).toEqual(legacy.body);
  });

  it("training-history is only mounted under /api/v1 (no double prefix, no unprefixed copy)", async () => {
    const v1 = await send("get", "/api/v1/training-history");
    expect(v1.status).toBe(200);
    expect(v1.body).toEqual({ items: [], nextCursor: null, hasMore: false });

    expect(isRouteNotFound(await send("get", "/training-history"))).toBe(true);
    expect(isRouteNotFound(await send("get", "/api/v1/api/v1/training-history"))).toBe(true);
  });

  it("unknown /api/v1 paths return the standard 404", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found", message: "Route not found" });
  });

  it("/api/v1/ready mirrors /ready", async () => {
    const legacy = await request(app).get("/ready");
    const v1 = await request(app).get("/api/v1/ready");
    expect(legacy.status).toBe(200);
    expect(v1.status).toBe(200);
    expect(v1.body).toEqual(legacy.body);
  });
});

describe("API versioning: /training-sessions collisions under /api/v1", () => {
  it("GET /api/v1/training-sessions stays the history list alias (ETag, page shape)", async () => {
    const res = await send("get", "/api/v1/training-sessions?limit=5");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(res.headers.etag).toBeTruthy();
  });

  it("GET /api/v1/training-sessions/:uuid stays the history detail alias", async () => {
    const res = await send("get", `/api/v1/training-sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found_or_not_yours");
  });

  it("GET /api/v1/training-sessions/:invalid still returns the history validation error", async () => {
    const res = await send("get", "/api/v1/training-sessions/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_session_id");
  });

  it("GET /api/v1/training-sessions/active and /history reach the write router, not the detail alias", async () => {
    // Before versioning, this path hit the history detail alias → 400 invalid_session_id.
    const active = await send("get", "/api/v1/training-sessions/active");
    const legacyActive = await send("get", "/training-sessions/active");
    expect(active.status).toBe(200);
    expect(active.body).toBeNull();
    expect(active.status).toBe(legacyActive.status);
    expect(active.body).toEqual(legacyActive.body);

    const history = await send("get", "/api/v1/training-sessions/history");
    expect(history.status).toBe(200);
    expect(history.body).toHaveProperty("deleted");
  });

  it("legacy GET /training-sessions and GET /training-sessions/:id remain 404 (no read alias unprefixed)", async () => {
    expect(isRouteNotFound(await send("get", "/training-sessions"))).toBe(true);
    expect(isRouteNotFound(await send("get", `/training-sessions/${SESSION_ID}`))).toBe(true);
  });

  it("write verbs on /api/v1/training-sessions/:id are handled by the write router", async () => {
    const put = await send("put", `/api/v1/training-sessions/${SESSION_ID}`, {});
    const legacyPut = await send("put", `/training-sessions/${SESSION_ID}`, {});
    expect(isRouteNotFound(put)).toBe(false);
    expect(put.status).toBe(legacyPut.status);
    expect(put.body).toEqual(legacyPut.body);

    const patch = await send("patch", `/api/v1/training-sessions/${SESSION_ID}/shared-to-profile`, {});
    const legacyPatch = await send("patch", `/training-sessions/${SESSION_ID}/shared-to-profile`, {});
    expect(isRouteNotFound(patch)).toBe(false);
    expect(patch.status).toBe(legacyPatch.status);
  });
});

describe("legacy deprecation headers", () => {
  it("unprefixed API responses carry Deprecation and a successor Link (without query)", async () => {
    const res = await send("get", "/feed?limit=5");
    expect(res.headers.deprecation).toBe("true");
    expect(res.headers.link).toBe('</api/v1/feed>; rel="successor-version"');
  });

  it("is also set on unauthenticated / error responses", async () => {
    const res = await request(app).get("/profile/me");
    expect(res.status).toBe(401);
    expect(res.headers.deprecation).toBe("true");
  });

  it("is not set on /api/v1, health probes or unknown paths", async () => {
    expect((await send("get", "/api/v1/feed")).headers.deprecation).toBeUndefined();
    expect((await request(app).get("/health")).headers.deprecation).toBeUndefined();
    expect((await request(app).get("/ready")).headers.deprecation).toBeUndefined();
    expect((await request(app).get("/nope")).headers.deprecation).toBeUndefined();
    // prefix match is per path segment
    expect((await request(app).get("/authors")).headers.deprecation).toBeUndefined();
  });
});

describe("rate limiter scoping", () => {
  it("the /exercises limiter no longer adds RateLimit headers to other routes", async () => {
    const feed = await send("get", "/feed");
    expect(feed.headers.ratelimit ?? feed.headers["ratelimit-limit"]).toBeUndefined();
    const exercises = await send("get", "/exercises");
    expect(exercises.headers.ratelimit ?? exercises.headers["ratelimit-limit"]).toBeDefined();
  });
});

describe("error handling", () => {
  it("malformed JSON → 400 invalid_json (was 500)", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json", message: "invalid_json" });
  });

  it("unexpected errors → 500 without stack or driver details", async () => {
    mockQuery.mockRejectedValue(new Error("connection terminated: secret-host:5432"));
    const res = await send("get", "/api/v1/training-history");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error", message: "Internal server error" });
    expect(res.text).not.toContain("secret-host");
    expect(res.text).not.toContain("at ");
  });
});
