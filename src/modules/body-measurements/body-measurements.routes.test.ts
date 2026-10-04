import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGetPool } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery };
  const mockGetPool = vi.fn(
    (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
  );
  return { mockQuery, mockGetPool };
});

vi.mock("../../db/pool.js", () => ({ getPool: mockGetPool }));

const { createApp } = await import("../../app.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const BASE = "/api/v1/profile/me/body-measurements";

const authHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET, { expiresIn: "1h" })}`,
});

const row = (date: string, overrides: Record<string, number | null> = {}) => ({
  date,
  waist_cm: null,
  chest_cm: null,
  hips_cm: null,
  neck_cm: null,
  arm_cm: null,
  thigh_cm: null,
  calf_cm: null,
  body_fat_pct: null,
  ...overrides,
});

const app = createApp();

beforeEach(() => {
  mockQuery.mockReset();
});

describe("GET /api/v1/profile/me/body-measurements", () => {
  it("requires auth", async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it("returns entries oldest first with the default limit", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row("2026-09-01", { waist_cm: 86, body_fat_pct: 17.5 }),
        row("2026-10-01", { waist_cm: 84.5 }),
      ],
    });

    const res = await request(app).get(BASE).set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0]).toEqual({
      date: "2026-09-01",
      waistCm: 86,
      chestCm: null,
      hipsCm: null,
      neckCm: null,
      armCm: null,
      thighCm: null,
      calfCm: null,
      bodyFatPct: 17.5,
    });
    const [sql, params] = mockQuery.mock.calls[0] ?? [];
    expect(String(sql)).toContain("FROM body_measurement_entries");
    expect(String(sql)).toContain("ORDER BY date ASC");
    expect(params).toEqual([USER_ID, 365]);
  });

  it("rejects a limit above 1000", async () => {
    const res = await request(app).get(`${BASE}?limit=1001`).set(authHeaders());
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is not served without the /api/v1 prefix", async () => {
    const res = await request(app)
      .get("/profile/me/body-measurements")
      .set(authHeaders());
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/v1/profile/me/body-measurements/:date", () => {
  it("replaces the entry, rounding to 0.1 and clearing omitted fields", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [row("2026-10-01", { waist_cm: 84.3, body_fat_pct: 15.2 })],
    });

    const res = await request(app)
      .put(`${BASE}/2026-10-01`)
      .set(authHeaders())
      .send({ waistCm: 84.26, chestCm: null, bodyFatPct: 15.2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: "2026-10-01",
      waistCm: 84.3,
      chestCm: null,
      bodyFatPct: 15.2,
    });
    const [sql, params] = mockQuery.mock.calls[0] ?? [];
    expect(String(sql)).toContain("ON CONFLICT (user_id, measured_on)");
    expect(params).toEqual([
      USER_ID,
      "2026-10-01",
      84.3,
      null,
      null,
      null,
      null,
      null,
      null,
      15.2,
    ]);
  });

  it.each([{}, { waistCm: null, bodyFatPct: null }])(
    "rejects body %j with no_measurements",
    async (body) => {
      const res = await request(app)
        .put(`${BASE}/2026-10-01`)
        .set(authHeaders())
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("no_measurements");
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ waistCm: 9.9 }],
    [{ thighCm: 300.1 }],
    [{ armCm: "40" }],
    [{ bodyFatPct: 1.9 }],
    [{ bodyFatPct: 75.1 }],
  ])("rejects body %j with invalid_measurement", async (body) => {
    const res = await request(app)
      .put(`${BASE}/2026-10-01`)
      .set(authHeaders())
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_measurement");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(["2026-02-30", "01-10-2026", "2999-01-01"])(
    "rejects date %s with invalid_date",
    async (date) => {
      const res = await request(app)
        .put(`${BASE}/${date}`)
        .set(authHeaders())
        .send({ waistCm: 80 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_date");
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it("returns 404 user_not_found when the account is gone", async () => {
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error("fk"), { code: "23503" }),
    );
    const res = await request(app)
      .put(`${BASE}/2026-10-01`)
      .set(authHeaders())
      .send({ waistCm: 80 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });
});

describe("DELETE /api/v1/profile/me/body-measurements/:date", () => {
  it("deletes the entry", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(app)
      .delete(`${BASE}/2026-10-01`)
      .set(authHeaders());

    expect(res.status).toBe(204);
    const [sql, params] = mockQuery.mock.calls[0] ?? [];
    expect(String(sql)).toContain("DELETE FROM body_measurement_entries");
    expect(params).toEqual([USER_ID, "2026-10-01"]);
  });

  it("returns 404 entry_not_found when there was no entry", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app)
      .delete(`${BASE}/2026-10-01`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("entry_not_found");
  });
});
