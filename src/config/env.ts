import "dotenv/config";

const portRaw = process.env.PORT ?? "3000";
const port = Number.parseInt(portRaw, 10);

const nodeEnv = process.env.NODE_ENV ?? "development";
const isDevelopment = nodeEnv !== "production";

// Empty string is treated the same as unset
const jwtSecret =
  process.env.JWT_SECRET?.trim() ||
  (isDevelopment ? "dev-secret-change-in-production-min-32-chars!!" : undefined);

if (!jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required in production");
}

export const env = {
  nodeEnv,
  port: Number.isFinite(port) && port > 0 ? port : 3000,
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN ?? null,
} as const;

export const isDev = isDevelopment;
