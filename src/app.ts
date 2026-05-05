import compression from "compression";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import path from "node:path";
import { isAppError } from "./common/errors.js";
import { env, isDev } from "./config/env.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { exercisesRouter } from "./modules/exercises/exercises.routes.js";
import { ensureExerciseImagesDir } from "./modules/exercises/exercises.image-upload.js";
import { healthRouter } from "./modules/health/health.routes.js";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");

  ensureExerciseImagesDir();
  app.use(
    "/uploads/exercise-images",
    express.static(path.join(process.cwd(), "uploads", "exercise-images")),
  );

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

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.statusCode).json({ error: err.code });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
};
