import { randomBytes } from "node:crypto";
import "dotenv/config";

export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string | null;
  /**
   * Express `trust proxy` value: `false` (no proxy — `req.ip` is the socket
   * address), a hop count, or a comma-separated list of trusted addresses /
   * subnets. Rate limiters key by `req.ip`, so trusting a proxy that is not
   * there lets clients spoof `X-Forwarded-For` and dodge the limits.
   */
  trustProxy: boolean | number | string;
}

export interface ParsedEnv {
  env: Env;
  isDev: boolean;
  /** Non-fatal configuration problems, logged once at startup. */
  warnings: string[];
}

/**
 * Secrets that are (or were) committed to this repository. A token signed
 * with one of them can be forged by anyone who has read the code.
 */
const PUBLIC_JWT_SECRETS = new Set([
  "dev-secret-change-in-production-min-32-chars!!",
  "change-me-before-going-to-production-min-32!!",
]);

const parseTrustProxy = (
  raw: string | undefined,
  isProduction: boolean,
): boolean | number | string => {
  const value = raw?.trim().toLowerCase();
  // Unset keeps the historical behaviour: one reverse proxy hop in production.
  if (!value) return isProduction ? 1 : false;
  if (value === "false" || value === "0" || value === "off") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return raw!.trim();
};

/**
 * Validates configuration. Throws (fail fast) when a required variable is
 * missing; returns warnings for risky-but-workable settings.
 *
 * - `JWT_SECRET` — required in production and must not be a value published
 *   in this repository. Outside production an empty value gets a random
 *   per-process secret (tokens stop working after a restart), never a fixed
 *   one: a fixed fallback let anyone forge tokens on a server accidentally
 *   started without `NODE_ENV=production`.
 * - `DATABASE_URL` — required in production. In development an empty value is
 *   allowed: the API starts and `/ready` reports 503.
 * - `CORS_ORIGIN` — empty in production is a warning, not an error: native
 *   mobile clients don't use CORS, but browsers (Flutter web) are blocked.
 * - `TRUST_PROXY` — see {@link Env.trustProxy}; production default is 1 hop.
 */
export const parseEnv = (source: NodeJS.ProcessEnv): ParsedEnv => {
  const portRaw = source.PORT ?? "3000";
  const port = Number.parseInt(portRaw, 10);

  const nodeEnv = source.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const warnings: string[] = [];

  // Empty string is treated the same as unset
  let jwtSecret = source.JWT_SECRET?.trim() || undefined;
  if (!jwtSecret) {
    if (isProduction) {
      throw new Error("JWT_SECRET environment variable is required in production");
    }
    jwtSecret = randomBytes(48).toString("base64");
    warnings.push(
      "JWT_SECRET is not set — using a random secret for this process; " +
        "tokens will stop working after a restart (set it in .env)",
    );
  } else if (PUBLIC_JWT_SECRETS.has(jwtSecret)) {
    if (isProduction) {
      throw new Error(
        "JWT_SECRET is a placeholder published in the repository — " +
          "generate one with `openssl rand -base64 48`",
      );
    }
    warnings.push("JWT_SECRET is a placeholder from the repository — fine locally only");
  }

  const databaseUrl = source.DATABASE_URL?.trim() ?? "";
  const corsOrigin = source.CORS_ORIGIN?.trim() || null;
  const trustProxy = parseTrustProxy(source.TRUST_PROXY, isProduction);

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
    if (source.TRUST_PROXY === undefined) {
      warnings.push(
        "TRUST_PROXY is not set — trusting 1 proxy hop; set TRUST_PROXY=false " +
          "when the API is exposed directly, or rate limits can be bypassed",
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
      trustProxy,
    },
    isDev: !isProduction,
    warnings,
  };
};

const parsed = parseEnv(process.env);

export const env: Readonly<Env> = Object.freeze(parsed.env);
export const isDev = parsed.isDev;
export const envWarnings: readonly string[] = parsed.warnings;
