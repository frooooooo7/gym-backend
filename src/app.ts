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
import {
  getRequestId,
  REQUEST_ID_HEADER,
  requestContext,
} from "./middleware/request-context.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { exercisesRouter } from "./modules/exercises/exercises.routes.js";
import { ensureExerciseImagesDir } from "./modules/exercises/exercises.image-upload.js";
import { SYSTEM_EXERCISE_IMAGES_URL_PREFIX } from "./modules/exercises/system-exercise-images.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { trainingHistoryRouter } from "./modules/training-history/training-history.routes.js";
import { trainingPlansRouter } from "./modules/training-plans/training-plans.routes.js";
import { trainingSessionsRouter } from "./modules/training-sessions/training-sessions.routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";
import { ensureAvatarsDir } from "./modules/profile/profile.avatar-upload.js";
import { feedRouter } from "./modules/feed/feed.routes.js";

const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
};

/** Body-parser errors (malformed JSON, oversized body) are client errors. */
const bodyParserError = (
  err: unknown,
): { status: number; code: string } | null => {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") return { status: 400, code: "invalid_json" };
  if (type === "entity.too.large") return { status: 413, code: "payload_too_large" };
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
  v1.use(feedRouter);
  // Unknown /api/v1/* must not fall through to the legacy mounts below.
  v1.use(notFound);
  return v1;
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.set("etag", false);
  if (!isDev) app.set("trust proxy", 1);

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
  // Committed to the repo, not the uploads volume; file names are stable ids,
  // so cache for a week rather than forever.
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

  app.use(compression());
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

  app.use(express.json({ limit: "1mb" }));

  // Versioned API. Legacy `/api/v1/training-history*` and
  // `/api/v1/training-sessions*` read aliases are served from here too.
  app.use(API_V1_PREFIX, createApiV1Router());

  // Legacy unprefixed API (same routers, same order as before versioning).
  // Health probes stay unprefixed by design and are not deprecated.
  app.use(healthRouter);
  app.use(LEGACY_API_PREFIXES, legacyApiHeaders);
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
    const clientError = bodyParserError(err);
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
