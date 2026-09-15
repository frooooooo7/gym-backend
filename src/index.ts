import { createApp } from "./app.js";
import { logger, serializeError } from "./common/logger.js";
import { env, envWarnings, isDev } from "./config/env.js";
import { closePool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";

for (const warning of envWarnings) {
  logger.warn(`[config] ${warning}`);
}

try {
  await runMigrations();
} catch (err) {
  logger.error("[migrate] failed, exiting", { error: serializeError(err) });
  await closePool().catch(() => undefined);
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.port, () => {
  logger.info(
    `[gym-backend] listening on http://localhost:${env.port} (${env.nodeEnv})`,
    { port: env.port, nodeEnv: env.nodeEnv },
  );
  if (isDev && !env.databaseUrl) {
    logger.warn(
      "[gym-backend] DATABASE_URL is empty — /ready will return 503 until set",
    );
  }
});
server.keepAliveTimeout = 65_000;
// Musi być dłuższy niż keepAliveTimeout, inaczej proxy trafia na zamknięte gniazdo.
server.headersTimeout = 66_000;

const shutdown = async (signal: string) => {
  logger.info(`[gym-backend] ${signal}, shutting down...`);
  server.close(() => {
    void closePool().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
