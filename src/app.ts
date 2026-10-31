import compression from "compression";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import helmet from "helmet";
import path from "node:path";
import { isAppError } from "./common/errors.js";
import { logger, serializeError } from "./common/logger.js";
import { env, isDev } from "./config/env.js";
import {
  API_V1_PREFIX,
  LEGACY_API_PREFIXES,
  legacyApiHeaders,
} from "./middleware/legacy-api.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import {
  getRequestId,
  REQUEST_ID_HEADER,
  requestContext,
} from "./middleware/request-context.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { bodyMeasurementsRouter } from "./modules/body-measurements/body-measurements.routes.js";
import { bodyWeightRouter } from "./modules/body-weight/body-weight.routes.js";
import { exercisesRouter } from "./modules/exercises/exercises.routes.js";
import { ensureExerciseImagesDir } from "./modules/exercises/exercises.image-upload.js";
import { SYSTEM_EXERCISE_IMAGES_URL_PREFIX } from "./modules/exercises/system-exercise-images.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { trainingHistoryRouter } from "./modules/training-history/training-history.routes.js";
import { trainingPlansRouter } from "./modules/training-plans/training-plans.routes.js";
import { trainingSessionsRouter } from "./modules/training-sessions/training-sessions.routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";
import { ensureAvatarsDir } from "./modules/profile/profile.avatar-upload.js";
import {
  ensurePostPhotosDir,
  postPhotosDir,
} from "./modules/training-sessions/training-sessions.post-photo.js";
import {
  ensurePlanCoversDir,
  planCoversDir,
} from "./modules/training-plans/training-plans.cover.js";
import { feedRouter } from "./modules/feed/feed.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";

const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
};

/**
 * Client errors that surface as exceptions: body-parser failures (malformed
 * JSON, oversized body) and Postgres rejecting a malformed value such as a
 * non-UUID id (`22P02 invalid_text_representation`) that slipped past
 * validation — a bad request, not a server fault.
 */
const clientErrorFrom = (
  err: unknown,
): { status: number; code: string } | null => {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") return { status: 400, code: "invalid_json" };
  if (type === "entity.too.large") return { status: 413, code: "payload_too_large" };
  if ((err as { code?: unknown } | null)?.code === "22P02") {
    return { status: 400, code: "invalid_input" };
  }
  return null;
};

/**
 * Every API route, path-relative, in match order. Mounted under `/api/v1`.
 *
 * Order matters where paths overlap: training-sessions (writes, `/active`,
 * `/history`) comes before training-history, whose read aliases
 * `GET /training-sessions` and `GET /training-sessions/:sessionId` then only
 * catch what the write router doesn't define.
 */
const createApiV1Router = (): Router => {
  const v1 = Router();
  v1.use(healthRouter);
  v1.use(authRouter);
  v1.use(exercisesRouter);
  v1.use(trainingPlansRouter);
  v1.use(trainingSessionsRouter);
  v1.use(trainingHistoryRouter);
  v1.use(profileRouter);
  v1.use(bodyWeightRouter);
  v1.use(bodyMeasurementsRouter);
  v1.use(feedRouter);
  v1.use(notificationsRouter);
  // Unknown /api/v1/* must not fall through to the legacy mounts below.
  v1.use(notFound);
  return v1;
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("trust proxy", env.trustProxy);

  app.use(requestContext);

  // CORS must run before the static upload mounts: Flutter web loads images
  // via fetch, so `/uploads/*` responses need Access-Control-Allow-Origin too.
  // Dev: allow all origins. Prod: whitelist via CORS_ORIGIN env var (comma-separated).
  const corsOrigin = isDev
    ? true
    : env.corsOrigin
      ? env.corsOrigin.split(",").map((s) => s.trim())
      : false;
  app.use(cors({ origin: corsOrigin, exposedHeaders: [REQUEST_ID_HEADER] }));

  // Before the static mounts, so uploads get nosniff / CSP too.
  // CORS (above) is the actual cross-origin gatekeeper for this API — Helmet's
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

  ensureExerciseImagesDir();
  const exerciseImagesDir = path.join(
    process.cwd(),
    "uploads",
    "exercise-images",
  );
  app.use(
    "/uploads/exercise-images",
    express.static(exerciseImagesDir, {
      maxAge: "365d",
      immutable: true,
      etag: false,
      lastModified: false,
    }),
  );

  // Bundled system exercise illustrations (see system-exercise-images.ts).
  // Committed to the repo, not the uploads volume. A redrawn image gets a new
  // slug, but cache for a week rather than forever in case one is replaced
  // in place.
  app.use(
    SYSTEM_EXERCISE_IMAGES_URL_PREFIX,
    express.static(path.join(process.cwd(), "public", "exercise-images"), {
      maxAge: "7d",
      etag: false,
    }),
  );

  ensureAvatarsDir();
  const avatarsDir = path.join(process.cwd(), "uploads", "avatars");
  app.use(
    "/uploads/avatars",
    express.static(avatarsDir, {
      maxAge: "365d",
      immutable: true,
      etag: false,
      lastModified: false,
    }),
  );

  ensurePostPhotosDir();
  app.use(
    "/uploads/post-photos",
    express.static(postPhotosDir, {
      maxAge: "365d",
      immutable: true,
      etag: false,
      lastModified: false,
    }),
  );

  ensurePlanCoversDir();
  app.use(
    "/uploads/plan-covers",
    express.static(planCoversDir, {
      maxAge: "365d",
      immutable: true,
      etag: false,
      lastModified: false,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: "1mb" }));

  // Versioned API. Legacy `/api/v1/training-history*` and
  // `/api/v1/training-sessions*` read aliases are served from here too.
  app.use(API_V1_PREFIX, apiLimiter, createApiV1Router());

  // Legacy unprefixed API (same routers, same order as before versioning).
  // Health probes stay unprefixed by design and are not deprecated.
  app.use(healthRouter);
  app.use(LEGACY_API_PREFIXES, apiLimiter, legacyApiHeaders);
  app.use(authRouter);
  app.use(exercisesRouter);
  app.use(trainingPlansRouter);
  app.use(trainingSessionsRouter);
  app.use(profileRouter);
  app.use(feedRouter);

  app.use(notFound);

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (isAppError(err)) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    const clientError = clientErrorFrom(err);
    if (clientError) {
      res
        .status(clientError.status)
        .json({ error: clientError.code, message: clientError.code });
      return;
    }
    logger.error("unhandled_error", {
      requestId: getRequestId(res),
      method: req.method,
      path: req.originalUrl.split("?")[0],
      error: serializeError(err),
    });
    // Never leak details (stack, driver messages) to clients.
    res.status(500).json({
      error: "internal_error",
      message: "Internal server error",
    });
  });

  return app;
};
