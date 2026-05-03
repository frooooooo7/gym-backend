import compression from "compression";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { env, isDev } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { exercisesRouter } from "./routes/exercises.js";
import { healthRouter } from "./routes/health.js";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");

  app.use(compression());
  app.use(helmet());

  // Dev: allow all origins. Prod: whitelist via CORS_ORIGIN env var (comma-separated).
  const corsOrigin = isDev
    ? true
    : env.corsOrigin
      ? env.corsOrigin.split(",").map((s) => s.trim())
      : false;
  app.use(cors({ origin: corsOrigin }));

  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(exercisesRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
};
