import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const PROD_OK = {
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(48),
  DATABASE_URL: "postgresql://gym:gym@db:5432/gym",
  CORS_ORIGIN: "https://app.example.com",
  TRUST_PROXY: "1",
};

describe("parseEnv", () => {
  it("development: defaults, empty DATABASE_URL allowed", () => {
    const { env, isDev, warnings } = parseEnv({
      NODE_ENV: "development",
      JWT_SECRET: "y".repeat(48),
    });
    expect(isDev).toBe(true);
    expect(env.port).toBe(3000);
    expect(env.databaseUrl).toBe("");
    expect(env.corsOrigin).toBeNull();
    expect(env.trustProxy).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("development: missing JWT_SECRET gets a random per-process secret", () => {
    const a = parseEnv({ NODE_ENV: "development" });
    const b = parseEnv({ NODE_ENV: "development" });
    expect(a.env.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(a.env.jwtSecret).not.toBe(b.env.jwtSecret);
    expect(a.env.jwtSecret).not.toBe("dev-secret-change-in-production-min-32-chars!!");
    expect(a.warnings.some((w) => w.includes("JWT_SECRET"))).toBe(true);
  });

  it.each([
    "dev-secret-change-in-production-min-32-chars!!",
    "change-me-before-going-to-production-min-32!!",
  ])("production: published placeholder secret %j fails fast", (secret) => {
    expect(() => parseEnv({ ...PROD_OK, JWT_SECRET: secret })).toThrow(/placeholder/);
  });

  it.each([
    [undefined, 1],
    ["false", false],
    ["0", false],
    ["2", 2],
    ["10.0.0.0/8, 127.0.0.1", "10.0.0.0/8, 127.0.0.1"],
  ])("production: TRUST_PROXY=%j → %j", (value, expected) => {
    const { env } = parseEnv({ ...PROD_OK, TRUST_PROXY: value });
    expect(env.trustProxy).toEqual(expected);
  });

  it("production: unset TRUST_PROXY is a warning", () => {
    const { warnings } = parseEnv({ ...PROD_OK, TRUST_PROXY: undefined });
    expect(warnings.some((w) => w.includes("TRUST_PROXY"))).toBe(true);
  });

  it("production: valid config passes without warnings", () => {
    const { env, isDev, warnings } = parseEnv({ ...PROD_OK, PORT: "8080" });
    expect(isDev).toBe(false);
    expect(env.port).toBe(8080);
    expect(warnings).toEqual([]);
  });

  it("production: missing JWT_SECRET fails fast", () => {
    expect(() => parseEnv({ ...PROD_OK, JWT_SECRET: "  " })).toThrow(/JWT_SECRET/);
  });

  it.each([undefined, "", "   "])(
    "production: DATABASE_URL=%j fails fast with a clear message",
    (value) => {
      expect(() => parseEnv({ ...PROD_OK, DATABASE_URL: value })).toThrow(
        /DATABASE_URL environment variable is required in production/,
      );
    },
  );

  it("production: empty CORS_ORIGIN is a warning, not an error", () => {
    const { env, warnings } = parseEnv({ ...PROD_OK, CORS_ORIGIN: "" });
    expect(env.corsOrigin).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/CORS_ORIGIN is empty/);
  });

  it("production: short JWT_SECRET is a warning", () => {
    const { warnings } = parseEnv({ ...PROD_OK, JWT_SECRET: "short-secret" });
    expect(warnings.some((w) => w.includes("JWT_SECRET"))).toBe(true);
  });
});
