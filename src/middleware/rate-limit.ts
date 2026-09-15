import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const json429 = { error: "too_many_requests" };

/** 10 failed attempts per IP per 15 min on /auth/login */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: json429,
});

/** 10 attempts per IP per hour on /auth/register */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
});

/** 300 requests per IP per minute on /exercises — covers heavy filter/search usage */
export const exercisesLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
});

/** Keys by authenticated user (mount after requireAuth), falls back to IP. */
const userOrIpKey = (req: Request): string => {
  const sub = (req as Request & { auth?: { sub?: string } }).auth?.sub;
  return sub ? `user:${sub}` : ipKeyGenerator(req.ip ?? "");
};

/** 60 follow/unfollow requests per authenticated user per minute (falls back to IP) */
export const followLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
  keyGenerator: userOrIpKey,
});

/** 30 new comments per authenticated user per minute (falls back to IP) */
export const commentLimiter = rateLimit({
  windowMs: 60 * 1_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
  keyGenerator: userOrIpKey,
});
