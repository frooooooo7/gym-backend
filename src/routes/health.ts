import { Router } from "express";
import { getPool } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

healthRouter.get("/ready", async (_req, res) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({
      status: "not_ready",
      reason: "DATABASE_URL is not configured",
    });
    return;
  }
  try {
    await pool.query("select 1 as ok");
    res.status(200).json({ status: "ready", database: "ok" });
  } catch {
    res.status(503).json({ status: "not_ready", database: "unreachable" });
  }
});
