import "dotenv/config";

export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string | null;
}

export interface ParsedEnv {
  env: Env;
  isDev: boolean;
  /** Non-fatal configuration problems, logged once at startup. */
  warnings: string[];
}

const DEV_JWT_SECRET = "dev-secret-change-in-production-min-32-chars!!";

/**
 * Validates configuration. Throws (fail fast) in production when a required
 * variable is missing; returns warnings for risky-but-workable settings.
 *
 * - `JWT_SECRET` — required in production (dev falls back to a fixed secret).
 * - `DATABASE_URL` — required in production. In development an empty value is
 *   allowed: the API starts and `/ready` reports 503.
 * - `CORS_ORIGIN` — empty in production is a warning, not an error: native
 *   mobile clients don't use CORS, but browsers (Flutter web) are blocked.
 */
export const parseEnv = (source: NodeJS.ProcessEnv): ParsedEnv => {
  const portRaw = source.PORT ?? "3000";
  const port = Number.parseInt(portRaw, 10);

  const nodeEnv = source.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const warnings: string[] = [];

  // Empty string is treated the same as unset
  const jwtSecret =
    source.JWT_SECRET?.trim() || (isProduction ? undefined : DEV_JWT_SECRET);
  if (!jwtSecret) {
    throw new Error("JWT_SECRET environment variable is required in production");
  }

  const databaseUrl = source.DATABASE_URL?.trim() ?? "";
  const corsOrigin = source.CORS_ORIGIN?.trim() || null;

  if (isProduction) {
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL environment variable is required in production " +
          "(e.g. postgresql://user:password@host:5432/gym)",
      );
    }
    if (jwtSecret.length < 32) {
      warnings.push("JWT_SECRET is shorter than 32 characters — use a long random value");
    }
    if (!corsOrigin) {
      warnings.push(
        "CORS_ORIGIN is empty — browsers (e.g. Flutter web) will be blocked by CORS; " +
          "native mobile apps are unaffected",
      );
    }
  }

  return {
    env: {
      nodeEnv,
      port: Number.isFinite(port) && port > 0 ? port : 3000,
      databaseUrl,
      jwtSecret,
      corsOrigin,
    },
    isDev: !isProduction,
    warnings,
  };
};

const parsed = parseEnv(process.env);

export const env: Readonly<Env> = Object.freeze(parsed.env);
export const isDev = parsed.isDev;
export const envWarnings: readonly string[] = parsed.warnings;
