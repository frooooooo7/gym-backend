import rateLimit from "express-rate-limit";

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
