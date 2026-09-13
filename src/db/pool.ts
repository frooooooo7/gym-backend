import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export const getPool = (): pg.Pool | null => {
  if (!env.databaseUrl.trim()) {
    return null;
  }
  if (!pool) {
    const parsedMax = Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10);
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 10,
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
  }
  return pool;
};

export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
