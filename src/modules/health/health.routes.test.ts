import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery };
  const mockGetPool = vi.fn(
    (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
  );
  return { mockQuery, mockPool, mockGetPool };
});

vi.mock("../../db/pool.js", () => ({ getPool: mockGetPool }));

const { createApp } = await import("../../app.js");

const app = createApp();

beforeEach(() => {
  mockQuery.mockReset();
  mockGetPool.mockClear();
});

describe.each(["", "/api/v1"])("health probes (prefix %j)", (prefix) => {
  it("GET /health → 200 without touching the database", async () => {
    const res = await request(app).get(`${prefix}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /ready → 200 when SELECT 1 succeeds", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const res = await request(app).get(`${prefix}/ready`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", database: "ok" });
    expect(String(mockQuery.mock.calls[0]?.[0]).toLowerCase()).toContain("select 1");
  });

  it("GET /ready → 503 when the database is unreachable", async () => {
    mockQuery.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await request(app).get(`${prefix}/ready`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "not_ready", database: "unreachable" });
  });

  it("GET /ready → 503 when DATABASE_URL is not configured", async () => {
    mockGetPool.mockReturnValueOnce(null);
    const res = await request(app).get(`${prefix}/ready`);
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
  });
});
