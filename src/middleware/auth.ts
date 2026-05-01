import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  auth: AuthPayload;
}

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    (req as AuthRequest).auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
};
