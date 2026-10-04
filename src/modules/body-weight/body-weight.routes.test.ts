import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockPool, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery };
  const mockGetPool = vi.fn(
    (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
  );
  return { mockQuery, mockPool, mockGetPool };
});

vi.mock("../../db/pool.js", () => ({
  getPool: mockGetPool,
}));

const { createApp } = await import("../../app.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const authHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET, { expiresIn: "1h" })}`,
});

const app = createApp();
const BASE = "/api/v1/body-weight";
const UPDATED_AT = new Date("2026-10-01T07:30:00.000Z");

/** `YYYY-MM-DD` of today shifted by [days] (UTC). */
const isoDay = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  mockQuery.mockReset();
  mockGetPool.mockReset();
  mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
});

describe("body weight routes", () => {
  it("requires auth", async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it("is not served on the legacy unprefixed path", async () => {
    const res = await request(app).get("/body-weight").set(authHeaders());
    expect(res.status).toBe(404);
  });

  it("GET lists entries oldest first, optionally within a range", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { date: "2026-09-01", weight_kg: 82.4, updated_at: UPDATED_AT },
        { date: "2026-09-08", weight_kg: 81.9, updated_at: UPDATED_AT },
      ],
    });

    const res = await request(app)
      .get(`${BASE}?from=2026-09-01&to=2026-09-30`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { date: "2026-09-01", weightKg: 82.4, updatedAt: UPDATED_AT.toISOString() },
        { date: "2026-09-08", weightKg: 81.9, updatedAt: UPDATED_AT.toISOString() },
      ],
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ORDER BY measured_on ASC");
    expect(params).toEqual([USER_ID, "2026-09-01", "2026-09-30"]);
  });

  it("GET without a range passes null bounds", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(BASE).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(mockQuery.mock.calls[0][1]).toEqual([USER_ID, null, null]);
  });

  it.each([
    ["from=2026-02-30", "invalid_date_range"],
    ["from=yesterday", "invalid_date_range"],
    ["from=2026-09-10&to=2026-09-01", "invalid_date_range"],
  ])("GET ?%s → 400 %s", async (query, code) => {
    const res = await request(app).get(`${BASE}?${query}`).set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: code });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("PUT upserts the day, rounds to 0.1 kg and syncs the profile weight", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ date: "2026-09-15", weight_kg: 81.5, updated_at: UPDATED_AT }],
    });

    const res = await request(app)
      .put(`${BASE}/2026-09-15`)
      .set(authHeaders())
      .send({ weightKg: 81.46 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: "2026-09-15",
      weightKg: 81.5,
      updatedAt: UPDATED_AT.toISOString(),
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (user_id, measured_on)");
    expect(sql).toContain("UPDATE users SET weight_kg = $3");
    expect(sql).toContain("measured_on > $2::date");
    expect(params).toEqual([USER_ID, "2026-09-15", 81.5]);
  });

  it("PUT accepts tomorrow (UTC) for clients east of UTC", async () => {
    const date = isoDay(1);
    mockQuery.mockResolvedValueOnce({
      rows: [{ date, weight_kg: 80, updated_at: UPDATED_AT }],
    });
    const res = await request(app)
      .put(`${BASE}/${date}`)
      .set(authHeaders())
      .send({ weightKg: 80 });
    expect(res.status).toBe(200);
  });

  it.each([
    [isoDay(2), { weightKg: 80 }, "invalid_date"],
    ["2026-13-01", { weightKg: 80 }, "invalid_date"],
    ["1899-12-31", { weightKg: 80 }, "invalid_date"],
    ["2026-09-15", { weightKg: 29.9 }, "invalid_weight"],
    ["2026-09-15", { weightKg: 300.1 }, "invalid_weight"],
    ["2026-09-15", { weightKg: "80" }, "invalid_weight"],
    ["2026-09-15", {}, "invalid_weight"],
  ])("PUT /%s %j → 400 %s", async (date, body, code) => {
    const res = await request(app)
      .put(`${BASE}/${date}`)
      .set(authHeaders())
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: code });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("PUT for a user deleted mid-request → 404 user_not_found", async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));
    const res = await request(app)
      .put(`${BASE}/2026-09-15`)
      .set(authHeaders())
      .send({ weightKg: 80 });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "user_not_found" });
  });

  it("DELETE is idempotent and falls the profile weight back to the previous entry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete(`${BASE}/2026-09-15`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM body_weight_entries");
    expect(sql).toContain("measured_on < $2::date");
    expect(sql).toContain("EXISTS (SELECT 1 FROM previous)");
    expect(params).toEqual([USER_ID, "2026-09-15"]);
  });

  it("DELETE validates the date", async () => {
    const res = await request(app).delete(`${BASE}/15-09-2026`).set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_date" });
  });
});
