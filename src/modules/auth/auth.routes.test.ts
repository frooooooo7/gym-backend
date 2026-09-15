import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real revocation check end-to-end (the shared setup mocks it).
vi.unmock("./token-version.store.js");

const { mockQuery, mockRelease, mockConnect, mockPool, mockGetPool } =
  vi.hoisted(() => {
    const mockQuery = vi.fn();
    const mockRelease = vi.fn();
    const mockConnect = vi.fn(async () => ({
      query: mockQuery,
      release: mockRelease,
    }));
    const mockPool = { query: mockQuery, connect: mockConnect };
    const mockGetPool = vi.fn(
      (): import("pg").Pool | null => mockPool as unknown as import("pg").Pool,
    );
    return { mockQuery, mockRelease, mockConnect, mockPool, mockGetPool };
  });

vi.mock("../../db/pool.js", () => ({
  getPool: mockGetPool,
}));

const { createApp } = await import("../../app.js");
const { clearTokenVersionCache } = await import("./token-version.store.js");

const JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const EMAIL = "tester@gym.com";
const OLD_PASSWORD = "OldPassw0rd";
const NEW_PASSWORD = "NewPassw0rd";
const OLD_HASH = bcrypt.hashSync(OLD_PASSWORD, 4);

const app = createApp();

// ---- tiny in-memory "users" table behind the mocked pool ----
interface FakeUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  token_version: number;
  password_hash: string;
  avatar_url: string | null;
}

let users = new Map<string, FakeUser>();
let deletedExerciseImageUrls: string[] = [];
let failOn: string | null = null;

const publicCols = (u: FakeUser) => ({
  id: u.id,
  email: u.email,
  first_name: u.first_name,
  last_name: u.last_name,
  token_version: u.token_version,
});

const result = (rows: unknown[]) => Promise.resolve({ rows, rowCount: rows.length });

const fakeDb = (sql: string, params: unknown[] = []) => {
  const s = String(sql);
  if (failOn && s.includes(failOn)) return Promise.reject(new Error(`boom: ${failOn}`));
  const id = params[0] as string;
  const u = users.get(id);

  if (s.includes("SELECT token_version FROM users WHERE id = $1")) {
    return result(u ? [{ token_version: u.token_version }] : []);
  }
  if (s.includes("password_hash FROM users WHERE email = $1")) {
    const byEmail = [...users.values()].find((x) => x.email === id);
    return result(byEmail ? [{ ...publicCols(byEmail), password_hash: byEmail.password_hash }] : []);
  }
  if (s.includes("password_hash FROM users WHERE id = $1")) {
    return result(u ? [{ ...publicCols(u), password_hash: u.password_hash }] : []);
  }
  if (s.includes("token_version FROM users WHERE id = $1")) {
    return result(u ? [publicCols(u)] : []);
  }
  if (s.includes("INSERT INTO users")) {
    const created: FakeUser = {
      id: randomUUID(),
      email: params[0] as string,
      password_hash: params[1] as string,
      first_name: params[2] as string,
      last_name: params[3] as string,
      token_version: 0,
      avatar_url: null,
    };
    users.set(created.id, created);
    return result([publicCols(created)]);
  }
  if (s.includes("SET password_hash = $3")) {
    if (!u || u.password_hash !== params[1]) return result([]);
    u.password_hash = params[2] as string;
    u.token_version += 1;
    return result([publicCols(u)]);
  }
  if (s.includes("UPDATE users SET token_version = token_version + 1")) {
    if (!u) return result([]);
    u.token_version += 1;
    return result([publicCols(u)]);
  }
  if (s.includes("FOR UPDATE")) {
    return result(u ? [{ avatar_url: u.avatar_url }] : []);
  }
  if (s.includes("DELETE FROM exercises")) {
    return result(deletedExerciseImageUrls.map((image_url) => ({ image_url })));
  }
  if (s.includes("DELETE FROM users")) {
    users.delete(id);
    return result([]);
  }
  return result([]);
};

const seedUser = (overrides: Partial<FakeUser> = {}): FakeUser => {
  const user: FakeUser = {
    id: USER_ID,
    email: EMAIL,
    first_name: "Jan",
    last_name: "Kowalski",
    token_version: 0,
    password_hash: OLD_HASH,
    avatar_url: null,
    ...overrides,
  };
  users.set(user.id, user);
  return user;
};

const tokenFor = (sub = USER_ID, tv?: number) =>
  jwt.sign(tv === undefined ? { sub, email: EMAIL } : { sub, email: EMAIL, tv }, JWT_SECRET, {
    expiresIn: "1h",
  });

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const versionLookups = () =>
  mockQuery.mock.calls.filter((c) =>
    String(c[0]).includes("SELECT token_version FROM users WHERE id = $1"),
  ).length;

const sqlLog = () => mockQuery.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());

const decodeTv = (token: string) => (jwt.verify(token, JWT_SECRET) as { tv?: number }).tv;

beforeEach(() => {
  users = new Map();
  deletedExerciseImageUrls = [];
  failOn = null;
  clearTokenVersionCache();
  mockQuery.mockReset();
  mockQuery.mockImplementation(fakeDb);
  mockRelease.mockReset();
  mockConnect.mockClear();
  mockGetPool.mockReset();
  mockGetPool.mockReturnValue(mockPool as unknown as import("pg").Pool);
});

describe("requireAuth token revocation", () => {
  it("401 unauthorized without Authorization header", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("401 invalid_token for a bad signature", async () => {
    seedUser();
    const bad = jwt.sign({ sub: USER_ID, email: EMAIL, tv: 0 }, "some-other-secret-that-is-long-enough");
    const res = await request(app).get("/auth/me").set(bearer(bad));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
    expect(versionLookups()).toBe(0);
  });

  it("401 invalid_token for an expired token", async () => {
    seedUser();
    const expired = jwt.sign({ sub: USER_ID, email: EMAIL, tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, JWT_SECRET);
    const res = await request(app).get("/auth/me").set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("accepts a legacy token without tv while token_version is 0", async () => {
    seedUser();
    const res = await request(app).get("/auth/me").set(bearer(tokenFor(USER_ID)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: USER_ID, email: EMAIL, firstName: "Jan", lastName: "Kowalski" });
  });

  it("rejects a legacy token without tv once token_version > 0", async () => {
    seedUser({ token_version: 1 });
    const res = await request(app).get("/auth/me").set(bearer(tokenFor(USER_ID)));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token_revoked");
  });

  it("401 token_revoked when tv does not match", async () => {
    seedUser({ token_version: 2 });
    const res = await request(app).get("/auth/me").set(bearer(tokenFor(USER_ID, 1)));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token_revoked");
    const ok = await request(app).get("/auth/me").set(bearer(tokenFor(USER_ID, 2)));
    expect(ok.status).toBe(200);
  });

  it("401 token_revoked when the user no longer exists", async () => {
    const res = await request(app).get("/auth/me").set(bearer(tokenFor(randomUUID(), 0)));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token_revoked");
  });

  it("caches the version lookup across requests", async () => {
    seedUser();
    const token = tokenFor(USER_ID, 0);
    await request(app).get("/auth/me").set(bearer(token));
    await request(app).get("/auth/me").set(bearer(token));
    await request(app).get("/profile/me").set(bearer(token));
    expect(versionLookups()).toBe(1);
  });

  it("503 database_unavailable when the pool is not configured", async () => {
    mockGetPool.mockReturnValue(null);
    const res = await request(app).get("/auth/me").set(bearer(tokenFor(USER_ID, 0)));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("database_unavailable");
  });

  it("503 database_unavailable (fails closed) when the lookup query fails", async () => {
    seedUser();
    failOn = "SELECT token_version FROM users";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(app).get("/auth/me").set(bearer(tokenFor(USER_ID, 0)));
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("database_unavailable");
  });
});

describe("login / register tokens carry tv", () => {
  it("login token has the current token_version", async () => {
    seedUser({ token_version: 3 });
    const res = await request(app).post("/auth/login").send({ email: EMAIL, password: OLD_PASSWORD });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["token", "user"]);
    expect(res.body.user).toEqual({ id: USER_ID, email: EMAIL, firstName: "Jan", lastName: "Kowalski" });
    expect(decodeTv(res.body.token)).toBe(3);
    const me = await request(app).get("/auth/me").set(bearer(res.body.token));
    expect(me.status).toBe(200);
  });

  it("register token has tv 0", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "new@gym.com", password: "Passw0rdX", firstName: "Anna", lastName: "Nowak" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "new@gym.com", firstName: "Anna", lastName: "Nowak" });
    expect(decodeTv(res.body.token)).toBe(0);
  });
});

describe("POST /auth/change-password", () => {
  it("401 without auth", async () => {
    const res = await request(app).post("/auth/change-password").send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("changes the password, bumps the version and revokes other tokens", async () => {
    seedUser();
    const oldToken = tokenFor(USER_ID, 0);
    // warm the cache with the old version
    expect((await request(app).get("/auth/me").set(bearer(oldToken))).status).toBe(200);

    const res = await request(app)
      .post("/auth/change-password")
      .set(bearer(oldToken))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USER_ID, email: EMAIL, firstName: "Jan", lastName: "Kowalski" });
    expect(decodeTv(res.body.token)).toBe(1);
    expect(bcrypt.compareSync(NEW_PASSWORD, users.get(USER_ID)!.password_hash)).toBe(true);

    const lookupsBefore = versionLookups();
    const revoked = await request(app).get("/auth/me").set(bearer(oldToken));
    expect(revoked.status).toBe(401);
    expect(revoked.body.error).toBe("token_revoked");
    const fresh = await request(app).get("/auth/me").set(bearer(res.body.token));
    expect(fresh.status).toBe(200);
    // invalidated in-process: no extra DB lookup needed
    expect(versionLookups()).toBe(lookupsBefore);
  });

  it("401 invalid_credentials for a wrong current password", async () => {
    seedUser();
    const res = await request(app)
      .post("/auth/change-password")
      .set(bearer(tokenFor(USER_ID, 0)))
      .send({ currentPassword: "WrongPassw0rd", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
    expect(users.get(USER_ID)!.token_version).toBe(0);
  });

  it.each([
    [{ currentPassword: OLD_PASSWORD, newPassword: "Sh0rt" }, "password_too_short"],
    [{ currentPassword: OLD_PASSWORD, newPassword: "alllowercase1" }, "password_too_weak"],
    [{ currentPassword: OLD_PASSWORD, newPassword: "NoDigitsHere" }, "password_too_weak"],
    [{ currentPassword: OLD_PASSWORD }, "missing_fields"],
    [{ newPassword: NEW_PASSWORD }, "missing_fields"],
    [{ currentPassword: "", newPassword: NEW_PASSWORD }, "missing_fields"],
    [{}, "missing_fields"],
  ])("400 for invalid body %j → %s", async (body, code) => {
    seedUser();
    const res = await request(app)
      .post("/auth/change-password")
      .set(bearer(tokenFor(USER_ID, 0)))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
  });

  it("uses the same weak-password codes as registration", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "weak@gym.com", password: "alllowercase1", firstName: "A", lastName: "B" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("password_too_weak");
  });

  it("400 password_unchanged when new equals current", async () => {
    seedUser();
    const res = await request(app)
      .post("/auth/change-password")
      .set(bearer(tokenFor(USER_ID, 0)))
      .send({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("password_unchanged");
  });

  it("401 invalid_credentials when the password changed concurrently", async () => {
    seedUser();
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (String(sql).includes("SET password_hash = $3")) {
        users.get(USER_ID)!.password_hash = "changed-elsewhere";
      }
      return fakeDb(sql, params);
    });
    const res = await request(app)
      .post("/auth/change-password")
      .set(bearer(tokenFor(USER_ID, 0)))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("429 too_many_requests after 10 failed attempts per user", async () => {
    const rlUser = "dddddddd-0000-0000-0000-000000000009";
    seedUser({ id: rlUser, email: "rl@gym.com" });
    const token = tokenFor(rlUser, 0);
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/auth/change-password")
        .set(bearer(token))
        .send({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD });
      expect(res.status).toBe(400);
    }
    const limited = await request(app)
      .post("/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("too_many_requests");
    // the limiter is per user: another user is unaffected
    const otherId = randomUUID();
    seedUser({ id: otherId });
    const other = await request(app)
      .post("/auth/change-password")
      .set(bearer(tokenFor(otherId, 0)))
      .send({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD });
    expect(other.status).toBe(400);
  });
});

describe("POST /auth/logout-all", () => {
  it("401 without auth", async () => {
    const res = await request(app).post("/auth/logout-all");
    expect(res.status).toBe(401);
  });

  it("bumps the version, returns a working token, revokes the rest", async () => {
    seedUser({ token_version: 4 });
    const oldToken = tokenFor(USER_ID, 4);
    const res = await request(app).post("/auth/logout-all").set(bearer(oldToken));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USER_ID, email: EMAIL, firstName: "Jan", lastName: "Kowalski" });
    expect(decodeTv(res.body.token)).toBe(5);
    expect(users.get(USER_ID)!.token_version).toBe(5);

    expect((await request(app).get("/auth/me").set(bearer(oldToken))).body.error).toBe("token_revoked");
    expect((await request(app).get("/auth/me").set(bearer(res.body.token))).status).toBe(200);
  });

  it("401 token_revoked with an already revoked token", async () => {
    seedUser({ token_version: 1 });
    const res = await request(app).post("/auth/logout-all").set(bearer(tokenFor(USER_ID, 0)));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token_revoked");
    expect(users.get(USER_ID)!.token_version).toBe(1);
  });
});

describe("DELETE /auth/me", () => {
  const AVATARS_DIR = path.join(process.cwd(), "uploads", "avatars");
  const IMAGES_DIR = path.join(process.cwd(), "uploads", "exercise-images");
  // DELETE /auth/me is limited to 5 attempts per user — use a fresh user per test.
  let uid = "";
  beforeEach(() => {
    uid = randomUUID();
  });

  it("401 without auth", async () => {
    const res = await request(app).delete("/auth/me").send({ password: OLD_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("deletes the account in one transaction, removes files, revokes the token", async () => {
    const avatarName = `test-delete-${randomUUID()}.png`;
    const imageName = `test-delete-${randomUUID()}.jpg`;
    await fs.mkdir(AVATARS_DIR, { recursive: true });
    await fs.mkdir(IMAGES_DIR, { recursive: true });
    await fs.writeFile(path.join(AVATARS_DIR, avatarName), "x");
    await fs.writeFile(path.join(IMAGES_DIR, imageName), "x");
    seedUser({ id: uid, avatar_url: `/uploads/avatars/${avatarName}` });
    deletedExerciseImageUrls = [`/uploads/exercise-images/${imageName}`];

    const token = tokenFor(uid, 0);
    expect((await request(app).get("/auth/me").set(bearer(token))).status).toBe(200);

    const res = await request(app).delete("/auth/me").set(bearer(token)).send({ password: OLD_PASSWORD });
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(users.has(uid)).toBe(false);

    const log = sqlLog();
    const idx = (p: string) => log.findIndex((s) => s.includes(p));
    expect(idx("BEGIN")).toBeGreaterThanOrEqual(0);
    expect(idx("BEGIN")).toBeLessThan(idx("FOR UPDATE"));
    expect(idx("FOR UPDATE")).toBeLessThan(idx("DELETE FROM training_plans"));
    expect(idx("DELETE FROM training_plans")).toBeLessThan(idx("DELETE FROM exercises"));
    expect(idx("DELETE FROM exercises")).toBeLessThan(idx("DELETE FROM users"));
    expect(idx("DELETE FROM users")).toBeLessThan(idx("COMMIT"));
    expect(log.find((s) => s.includes("DELETE FROM exercises"))).toContain("NOT EXISTS");
    expect(mockRelease).toHaveBeenCalledTimes(1);

    await expect(fs.access(path.join(AVATARS_DIR, avatarName))).rejects.toThrow();
    await expect(fs.access(path.join(IMAGES_DIR, imageName))).rejects.toThrow();

    const after = await request(app).get("/auth/me").set(bearer(token));
    expect(after.status).toBe(401);
    expect(after.body.error).toBe("token_revoked");
  });

  it("succeeds when upload files are already gone", async () => {
    seedUser({ id: uid, avatar_url: `/uploads/avatars/missing-${randomUUID()}.png` });
    deletedExerciseImageUrls = [`/uploads/exercise-images/missing-${randomUUID()}.jpg`];
    const res = await request(app).delete("/auth/me").set(bearer(tokenFor(uid, 0))).send({ password: OLD_PASSWORD });
    expect(res.status).toBe(204);
  });

  it("401 invalid_credentials for a wrong password, nothing deleted", async () => {
    seedUser({ id: uid });
    const res = await request(app).delete("/auth/me").set(bearer(tokenFor(uid, 0))).send({ password: "WrongPassw0rd" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
    expect(users.has(uid)).toBe(true);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ password: "" }], [{ password: 123 }]])(
    "400 missing_fields for body %j",
    async (body) => {
      seedUser({ id: uid });
      const res = await request(app).delete("/auth/me").set(bearer(tokenFor(uid, 0))).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing_fields");
    },
  );

  it("400 missing_fields without any body", async () => {
    seedUser({ id: uid });
    const res = await request(app).delete("/auth/me").set(bearer(tokenFor(uid, 0)));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_fields");
  });

  it("rolls back and returns 500 when a statement fails", async () => {
    seedUser({ id: uid });
    failOn = "DELETE FROM exercises";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(app).delete("/auth/me").set(bearer(tokenFor(uid, 0))).send({ password: OLD_PASSWORD });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(sqlLog().some((s) => s === "ROLLBACK")).toBe(true);
    expect(sqlLog().some((s) => s === "COMMIT")).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(users.has(uid)).toBe(true);
  });

  it("429 too_many_requests after 5 attempts per user", async () => {
    const rlUser = "eeeeeeee-0000-0000-0000-000000000009";
    seedUser({ id: rlUser, email: "rl2@gym.com" });
    const token = tokenFor(rlUser, 0);
    for (let i = 0; i < 5; i++) {
      const res = await request(app).delete("/auth/me").set(bearer(token)).send({});
      expect(res.status).toBe(400);
    }
    const limited = await request(app).delete("/auth/me").set(bearer(token)).send({ password: OLD_PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("too_many_requests");
    expect(users.has(rlUser)).toBe(true);
  });
});
