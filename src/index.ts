import { createApp } from "./app.js";
import { env, isDev } from "./config/env.js";
import { closePool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";

await runMigrations();

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(
    `[gym-backend] listening on http://localhost:${env.port} (${env.nodeEnv})`,
  );
  if (isDev && !env.databaseUrl.trim()) {
    console.warn(
      "[gym-backend] DATABASE_URL is empty — /ready will return 503 until set",
    );
  }
});

const shutdown = async (signal: string) => {
  console.log(`[gym-backend] ${signal}, shutting down...`);
  server.close(() => {
    void closePool().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
