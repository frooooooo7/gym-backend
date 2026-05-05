import { AppError } from "../common/errors.js";
import { getPool } from "./pool.js";

export const requirePool = () => {
  const pool = getPool();
  if (!pool) {
    throw new AppError(503, "database_unavailable");
  }
  return pool;
};
