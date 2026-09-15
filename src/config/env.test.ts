import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const PROD_OK = {
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(48),
  DATABASE_URL: "postgresql://gym:gym@db:5432/gym",
  CORS_ORIGIN: "https://app.example.com",
};

describe("parseEnv", () => {
  it("development: defaults, no warnings, empty DATABASE_URL allowed", () => {
    const { env, isDev, warnings } = parseEnv({ NODE_ENV: "development" });
    expect(isDev).toBe(true);
    expect(env.port).toBe(3000);
    expect(env.databaseUrl).toBe("");
    expect(env.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(env.corsOrigin).toBeNull();
    expect(warnings).toEqual([]);
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
