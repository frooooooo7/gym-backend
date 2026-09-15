import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery };
  const mockGetPool = vi.fn(
    (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
  );
  return { mockQuery, mockGetPool };
});

vi.mock("../db/pool.js", () => ({ getPool: mockGetPool }));

const { createApp } = await import("../app.js");
const { setLogSink } = await import("../common/logger.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const app = createApp();
let lines: Array<{ line: string; level: string }> = [];

const withEnv = (vars: Record<string, string | undefined>) => {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
};

let restoreEnv: () => void = () => undefined;

beforeEach(() => {
  lines = [];
  setLogSink((line, level) => lines.push({ line, level }));
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  restoreEnv();
  restoreEnv = () => undefined;
  setLogSink(null);
});

/** `finish` fires after supertest resolves in some cases — give it a tick. */
const flush = () => new Promise((r) => setImmediate(r));

describe("X-Request-Id", () => {
  it("generates a UUID when the client sends none", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(UUID_RE);
  });

  it("propagates a valid incoming id", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "edge-proxy:abc.123_XYZ");
    expect(res.headers["x-request-id"]).toBe("edge-proxy:abc.123_XYZ");
  });

  it.each(["short", "has spaces in it", "x".repeat(129), "semi;colon-value"])(
    "replaces an invalid incoming id %j",
    async (bad) => {
      const res = await request(app).get("/health").set("X-Request-Id", bad);
      expect(res.headers["x-request-id"]).toMatch(UUID_RE);
    },
  );

  it("is exposed to browsers via CORS", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5000");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Request-Id");
  });
});

describe("request logging", () => {
  it("is silent under tests by default", async () => {
    setLogSink(null);
    const write = vi.spyOn(process.stdout, "write");
    await request(app).get("/api/v1/nope");
    await flush();
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("production: one JSON line with method, path (no query), status, duration, user and request id", async () => {
    restoreEnv = withEnv({ NODE_ENV: "production", LOG_LEVEL: "info" });
    const token = jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET);
    await request(app)
      .get("/api/v1/users/search?q=secret-term")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Request-Id", "req-12345678");
    await flush();

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!.line);
    expect(entry).toMatchObject({
      level: "info",
      msg: "request",
      requestId: "req-12345678",
      method: "GET",
      path: "/api/v1/users/search",
      status: 200,
      userId: USER_ID,
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(typeof entry.time).toBe("string");
    expect(lines[0]!.line).not.toContain("secret-term");
  });

  it("development: compact text line", async () => {
    restoreEnv = withEnv({ NODE_ENV: "development", LOG_LEVEL: "info" });
    await request(app).get("/feed?cursor=abc").set("X-Request-Id", "req-abcdefgh");
    await flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} INFO  GET \/feed 401 [\d.]+ms rid=req-abcdefgh$/,
    );
  });

  it("skips health probes on both mounts", async () => {
    restoreEnv = withEnv({ NODE_ENV: "production", LOG_LEVEL: "debug" });
    mockQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
    await request(app).get("/health");
    await request(app).get("/ready");
    await request(app).get("/api/v1/health");
    await request(app).get("/api/v1/ready?x=1");
    await flush();
    expect(lines).toEqual([]);
  });

  it("LOG_LEVEL=warn hides request lines", async () => {
    restoreEnv = withEnv({ NODE_ENV: "production", LOG_LEVEL: "warn" });
    await request(app).get("/feed");
    await flush();
    expect(lines).toEqual([]);
  });

  it("unexpected errors: logged with request id and stack, client gets no details", async () => {
    restoreEnv = withEnv({ NODE_ENV: "production", LOG_LEVEL: "info" });
    const token = jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET);
    mockQuery.mockRejectedValue(new Error("relation does not exist"));

    const res = await request(app)
      .get("/api/v1/training-history")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Request-Id", "req-err-0001");
    await flush();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error", message: "Internal server error" });

    const entries = lines.map((l) => JSON.parse(l.line));
    const errorEntry = entries.find((e) => e.msg === "unhandled_error");
    expect(errorEntry).toMatchObject({
      level: "error",
      requestId: "req-err-0001",
      method: "GET",
      path: "/api/v1/training-history",
      error: { message: "relation does not exist" },
    });
    expect(errorEntry.error.stack).toContain("Error: relation does not exist");
    const requestEntry = entries.find((e) => e.msg === "request");
    expect(requestEntry).toMatchObject({ level: "error", status: 500, requestId: "req-err-0001" });
  });
});
