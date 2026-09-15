import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isAppError } from "../common/errors.js";
import { env } from "../config/env.js";
import { isTokenVersionCurrent } from "../modules/auth/token-version.store.js";

export interface AuthPayload {
  sub: string;
  email: string;
  /** users.token_version at issue time; tokens issued before it existed lack it (= 0). */
  tv?: number;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  auth: AuthPayload;
}

/**
 * Verifies the JWT signature, then that its `tv` claim still matches the
 * user's token_version (cached, see token-version.store.ts). Responses:
 * - 401 unauthorized  — missing / malformed Authorization header
 * - 401 invalid_token — bad signature or expired
 * - 401 token_revoked — version bumped (password change, logout-all) or user deleted
 * - 503 database_unavailable — version could not be checked (fails closed)
 */
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid Authorization header",
    });
    return;
  }

  const token = header.slice(7);
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
  } catch {
    res.status(401).json({
      error: "invalid_token",
      message: "JWT token is invalid or expired",
    });
    return;
  }

  if (typeof payload?.sub !== "string") {
    res.status(401).json({
      error: "invalid_token",
      message: "JWT token is invalid or expired",
    });
    return;
  }

  const tokenVersion = typeof payload.tv === "number" ? payload.tv : 0;

  isTokenVersionCurrent(payload.sub, tokenVersion).then(
    (current) => {
      if (!current) {
        res.status(401).json({
          error: "token_revoked",
          message: "Session has been revoked, please sign in again",
        });
        return;
      }
      (req as AuthRequest).auth = payload;
      next();
    },
    (err: unknown) => {
      if (isAppError(err)) {
        next(err);
        return;
      }
      console.error("[auth] token version check failed", err);
      res.status(503).json({
        error: "database_unavailable",
        message: "database_unavailable",
      });
    },
  );
};
