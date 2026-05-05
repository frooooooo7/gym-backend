import { getPool } from "../../db/pool.js";
import { healthRepository } from "./health.repository.js";

export const healthService = {
  getReadiness: async (): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> => {
    const pool = getPool();
    if (!pool) {
      return {
        status: 503,
        body: {
          status: "not_ready",
          reason: "DATABASE_URL is not configured",
        },
      };
    }

    try {
      await healthRepository.ping(pool);
      return {
        status: 200,
        body: { status: "ready", database: "ok" },
      };
    } catch {
      return {
        status: 503,
        body: { status: "not_ready", database: "unreachable" },
      };
    }
  },
};
