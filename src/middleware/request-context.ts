import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isJsonLogFormat, logger } from "../common/logger.js";

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Accept client/proxy ids that are short and header-safe; anything else is replaced. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Probes are polled constantly — logging them would drown real traffic. */
const UNLOGGED_PATHS = new Set([
  "/health",
  "/ready",
  "/api/v1/health",
  "/api/v1/ready",
]);

export const getRequestId = (res: Response): string | undefined =>
  typeof res.locals.requestId === "string" ? res.locals.requestId : undefined;

/** Path without the query string (queries may carry search terms or cursors). */
const pathOf = (req: Request): string => {
  const url = req.originalUrl || req.url;
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
};

/**
 * Assigns `X-Request-Id` (propagates a valid incoming one, else a new UUID),
 * echoes it on the response and writes one log line when the response is done.
 */
export const requestContext = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const requestId =
    incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const path = pathOf(req);
  if (UNLOGGED_PATHS.has(path)) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  let logged = false;
  const logOnce = () => {
    if (logged) return;
    logged = true;
    const durationMs =
      Math.round(Number(process.hrtime.bigint() - startedAt) / 10_000) / 100;
    const status = res.statusCode;
    const aborted = !res.writableFinished;
    const userId = (req as Request & { auth?: { sub?: string } }).auth?.sub;
    const level = status >= 500 ? "error" : "info";

    if (isJsonLogFormat()) {
      logger[level]("request", {
        requestId,
        method: req.method,
        path,
        status,
        durationMs,
        userId,
        aborted: aborted || undefined,
      });
      return;
    }
    logger[level](
      `${req.method} ${path} ${status} ${durationMs}ms${aborted ? " (aborted)" : ""}`,
      { user: userId, rid: requestId },
    );
  };

  res.on("finish", logOnce);
  res.on("close", logOnce);
  next();
};
