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
import { trainingHistoryRouter } from "./modules/training-history/training-history.routes.js";
import { trainingPlansRouter } from "./modules/training-plans/training-plans.routes.js";
import { trainingSessionsRouter } from "./modules/training-sessions/training-sessions.routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");

  ensureExerciseImagesDir();
  app.use(
    "/uploads/exercise-images",
    express.static(path.join(process.cwd(), "uploads", "exercise-images")),
  );

  app.use(compression());
  // CORS (below) is the actual cross-origin gatekeeper for this API — Helmet's
  // default same-origin CORP would silently block browsers from reading
  // responses across origins even when CORS allows the request (e.g. Flutter
  // web's dev server port vs this API's port), so relax it to cross-origin.
  // HSTS is also disabled in dev: it has no TLS listener to redirect to, and
  // once a browser receives it for `localhost` it force-upgrades ALL local
  // ports to https for up to a year, breaking every plain-http dev server on
  // that host until the browser's HSTS state for localhost is cleared.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: isDev ? false : undefined,
    }),
  );

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
  app.use(trainingPlansRouter);
  app.use(trainingHistoryRouter);
  app.use(trainingSessionsRouter);
  app.use(profileRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "Route not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({
      error: "internal_error",
      message: "Internal server error",
    });
  });

  return app;
};
