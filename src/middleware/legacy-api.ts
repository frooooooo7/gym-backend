import type { NextFunction, Request, Response } from "express";

export const API_V1_PREFIX = "/api/v1";

/**
 * Top-level path segments that are still served without the `/api/v1` prefix
 * (the Flutter client used them before versioning). Every one of them is also
 * available under `/api/v1` with an identical path.
 */
export const LEGACY_API_PREFIXES = [
  "/auth",
  "/exercises",
  "/training-plans",
  "/training-sessions",
  "/profile",
  "/users",
  "/feed",
  "/posts",
];

/**
 * Marks unprefixed responses as deprecated (`Deprecation: true`) and points
 * to the versioned path (`Link: </api/v1/...>; rel="successor-version"`).
 * Purely informational — status and body are untouched.
 */
export const legacyApiHeaders = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const url = req.originalUrl;
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", `<${API_V1_PREFIX}${path}>; rel="successor-version"`);
  next();
};
