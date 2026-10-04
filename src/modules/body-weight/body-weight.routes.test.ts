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
const { isValidMeasurementDay } = await import("./body-weight.schemas.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const BASE = "/api/v1/profile/me/body-weight";

const authHeaders = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: USER_ID, email: "t@gym.com" }, JWT_SECRET, { expiresIn: "1h" })}`,
});

const app = createApp();

beforeEach(() => {
  mockQuery.mockReset();
});

describe("isValidMeasurementDay", () => {
  const now = new Date("2026-10-04T23:30:00Z");

  it.each([
    ["2026-10-04", true],
    ["2026-10-05", true], // client ahead of UTC
    ["2026-10-06", false],
    ["2020-02-29", true],
    ["2021-02-29", false],
    ["1899-12-31", false],
    ["2026-1-04", false],
    ["yesterday", false],
  ])("%s → %s", (value, expected) => {
    expect(isValidMeasurementDay(value, now)).toBe(expected);
  });
});

describe("GET /api/v1/profile/me/body-weight", () => {
  it("requires auth", async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it("returns entries oldest first with the default limit", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { date: "2026-09-01", weight_kg: 82.5 },
        { date: "2026-10-01", weight_kg: 81 },
      ],
    });

    const res = await request(app).get(BASE).set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      entries: [
        { date: "2026-09-01", weightKg: 82.5 },
        { date: "2026-10-01", weightKg: 81 },
      ],
    });
    const [sql, params] = mockQuery.mock.calls[0] ?? [];
    expect(String(sql)).toContain("FROM body_weight_entries");
    expect(String(sql)).toContain("ORDER BY date ASC");
    expect(params).toEqual([USER_ID, 365]);
  });

  it("rejects a limit above 1000", async () => {
    const res = await request(app).get(`${BASE}?limit=1001`).set(authHeaders());
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is not served without the /api/v1 prefix", async () => {
    const res = await request(app).get("/profile/me/body-weight").set(authHeaders());
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/v1/profile/me/body-weight/:date", () => {
  it("upserts the entry, rounded to 0.1 kg, and syncs the current weight", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ date: "2026-10-01", weight_kg: 81.3 }],
    });

    const res = await request(app)
      .put(`${BASE}/2026-10-01`)
      .set(authHeaders())
      .send({ weightKg: 81.26 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ date: "2026-10-01", weightKg: 81.3 });
    const [sql, params] = mockQuery.mock.calls[0] ?? [];
    expect(String(sql)).toContain("ON CONFLICT (user_id, measured_on)");
    expect(String(sql)).toContain("UPDATE users SET weight_kg = $3");
    expect(String(sql)).toContain("measured_on > $2::date");
    expect(params).toEqual([USER_ID, "2026-10-01", 81.3]);
  });

  it.each([
    [{ weightKg: 29.9 }],
    [{ weightKg: 300.1 }],
    [{ weightKg: "80" }],
    [{}],
  ])("rejects body %j with invalid_weight", async (body) => {
    const res = await request(app)
      .put(`${BASE}/2026-10-01`)
      .set(authHeaders())
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_weight");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(["2026-02-30", "01-10-2026", "2999-01-01"])(
    "rejects date %s with invalid_date",
    async (date) => {
      const res = await request(app)
        .put(`${BASE}/${date}`)
        .set(authHeaders())
        .send({ weightKg: 80 });
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
      .send({ weightKg: 80 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });
});

describe("DELETE /api/v1/profile/me/body-weight/:date", () => {
  it("deletes the entry and falls back to the previous one", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ deleted: 1 }] });

    const res = await request(app).delete(`${BASE}/2026-10-01`).set(authHeaders());

    expect(res.status).toBe(204);
    const [sql, params] = mockQuery.mock.calls[0] ?? [];
    expect(String(sql)).toContain("DELETE FROM body_weight_entries");
    expect(String(sql)).toContain("measured_on < $2::date");
    expect(params).toEqual([USER_ID, "2026-10-01"]);
  });

  it("returns 404 entry_not_found when there was no entry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ deleted: 0 }] });
    const res = await request(app).delete(`${BASE}/2026-10-01`).set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("entry_not_found");
  });
});
