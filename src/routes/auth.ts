import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../middleware/rate-limit.js";

export const authRouter = Router();

const SALT_ROUNDS = 12;
const TOKEN_TTL = "30d";

// Pre-computed once at startup — ensures constant-time comparison in /auth/login
// even when the supplied email doesn't exist (prevents timing-based enumeration).
const DUMMY_HASH = await bcrypt.hash("__timing_guard_dummy__", SALT_ROUNDS);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email("invalid_email"),
  password: z
    .string()
    .min(8, "password_too_short")
    .regex(/[A-Z]/, "password_too_weak")
    .regex(/[0-9]/, "password_too_weak"),
  firstName: z
    .string()
    .min(1, "missing_fields")
    .max(50)
    .transform((s) => s.trim()),
  lastName: z
    .string()
    .min(1, "missing_fields")
    .max(50)
    .transform((s) => s.trim()),
});

const loginSchema = z.object({
  email: z.string().email("invalid_email"),
  password: z.string().min(1, "missing_fields"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeToken = (id: string, email: string): string =>
  jwt.sign({ sub: id, email }, env.jwtSecret, { expiresIn: TOKEN_TTL });

const formatUser = (row: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}) => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
});

const firstZodError = (issues: z.ZodIssue[]): string => {
  const issue = issues[0];
  if (!issue) return "missing_fields";
  // Use the custom message passed to .min() / .regex() / .email()
  return issue.message;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

authRouter.post("/auth/register", registerLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstZodError(parsed.error.issues) });
    return;
  }

  const { email, password, firstName, lastName } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Single round-trip + atomic — ON CONFLICT handles unique violation safely.
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, first_name, last_name`,
      [normalizedEmail, passwordHash, firstName, lastName],
    );

    if (rows.length === 0) {
      res.status(409).json({ error: "email_taken" });
      return;
    }

    const user = rows[0] as {
      id: string;
      email: string;
      first_name: string;
      last_name: string;
    };

    res.status(201).json({
      token: makeToken(user.id, user.email),
      user: formatUser(user),
    });
  } catch (err) {
    console.error("[auth/register]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

authRouter.post("/auth/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstZodError(parsed.error.issues) });
    return;
  }

  const { email, password } = parsed.data;

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash, first_name, last_name FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    const user = rows[0] as
      | {
          id: string;
          email: string;
          password_hash: string;
          first_name: string;
          last_name: string;
        }
      | undefined;

    // Always run bcrypt.compare — even when user is not found — to ensure
    // response time is constant regardless of whether the email exists.
    const hashToCompare = user?.password_hash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hashToCompare);

    if (!user || !valid) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    res.status(200).json({
      token: makeToken(user.id, user.email),
      user: formatUser(user),
    });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

authRouter.get("/auth/me", requireAuth, async (req, res) => {
  const { sub } = (req as AuthRequest).auth;

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email, first_name, last_name FROM users WHERE id = $1",
      [sub],
    );

    const user = rows[0] as
      | { id: string; email: string; first_name: string; last_name: string }
      | undefined;

    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    res.status(200).json(formatUser(user));
  } catch (err) {
    console.error("[auth/me]", err);
    res.status(500).json({ error: "internal_error" });
  }
});
