import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

export const exercisesRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const VALID_MUSCLES = [
  "chest", "back", "legs", "shoulders", "biceps",
  "triceps", "abs", "glutes",
] as const;

const VALID_CATEGORIES = [
  "compound", "isolation", "cardio", "mobility", "plyometric", "calisthenics",
] as const;

const VALID_FILTERS = ["all", "mine", "favourite", "recent"] as const;

const listQuerySchema = z.object({
  q:        z.string().optional().default(""),
  muscle:   z.enum(["all", ...VALID_MUSCLES]).optional().default("all"),
  filter:   z.enum(VALID_FILTERS).optional().default("all"),
  limit:    z.coerce.number().int().min(1).max(100).optional().default(50),
  offset:   z.coerce.number().int().min(0).optional().default(0),
});

const upsertBodySchema = z.object({
  name:     z.string().min(1, "missing_name").max(120).transform((s) => s.trim()),
  muscles:  z.array(z.enum(VALID_MUSCLES)).min(1, "missing_muscles"),
  category: z.enum(VALID_CATEGORIES, { message: "invalid_category" }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExerciseRow {
  id: string;
  name: string;
  muscles: string[];
  category: string;
  created_by: string | null;
  is_favourite: boolean;
}

const formatExercise = (row: ExerciseRow, userId?: string) => ({
  id:          row.id,
  name:        row.name,
  muscles:     row.muscles,
  category:    row.category,
  isFavourite: row.is_favourite,
  isMine:      userId ? row.created_by === userId : false,
});

const firstZodError = (issues: z.ZodIssue[]): string =>
  issues[0]?.message ?? "missing_fields";

// ---------------------------------------------------------------------------
// GET /exercises — list with optional filters
// ---------------------------------------------------------------------------

exercisesRouter.get("/exercises", requireAuth, async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: firstZodError(parsed.error.issues) });
    return;
  }

  const { q, muscle, filter, limit, offset } = parsed.data;
  const userId = (req as AuthRequest).auth.sub;

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const params: unknown[] = [userId];
    const conditions: string[] = [];

    // Search by name
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`lower(e.name) LIKE $${params.length}`);
    }

    // Filter by muscle group
    if (muscle !== "all") {
      params.push(muscle);
      conditions.push(`$${params.length} = ANY(e.muscles)`);
    }

    // Filter by list type
    switch (filter) {
      case "mine":
        conditions.push(`e.created_by = $1`);
        break;
      case "favourite":
        conditions.push(`ufe.user_id IS NOT NULL`);
        break;
      case "recent":
        conditions.push(`e.created_at > now() - INTERVAL '30 days'`);
        break;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit, offset);
    const limitParam  = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    const sql = `
      SELECT
        e.id,
        e.name,
        e.muscles,
        e.category,
        e.created_by,
        (ufe.user_id IS NOT NULL) AS is_favourite
      FROM exercises e
      LEFT JOIN user_favourite_exercises ufe
        ON ufe.exercise_id = e.id AND ufe.user_id = $1
      ${where}
      ORDER BY e.name
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const { rows } = await pool.query(sql, params);

    res.json((rows as ExerciseRow[]).map((r) => formatExercise(r, userId)));
  } catch (err) {
    console.error("[exercises/list]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /exercises — create a custom exercise
// ---------------------------------------------------------------------------

exercisesRouter.post("/exercises", requireAuth, async (req, res) => {
  const parsed = upsertBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstZodError(parsed.error.issues) });
    return;
  }

  const { name, muscles, category } = parsed.data;
  const userId = (req as AuthRequest).auth.sub;

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO exercises (name, muscles, category, is_system, created_by)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, name, muscles, category, created_by`,
      [name, muscles, category, userId],
    );

    const row = rows[0] as ExerciseRow;
    res.status(201).json(formatExercise({ ...row, is_favourite: false }, userId));
  } catch (err) {
    console.error("[exercises/create]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// PUT /exercises/:id — update own exercise
// ---------------------------------------------------------------------------

exercisesRouter.put("/exercises/:id", requireAuth, async (req, res) => {
  const parsed = upsertBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstZodError(parsed.error.issues) });
    return;
  }

  const { name, muscles, category } = parsed.data;
  const { id } = req.params;
  const userId = (req as AuthRequest).auth.sub;

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const { rows } = await pool.query(
      `UPDATE exercises
       SET name = $1, muscles = $2, category = $3
       WHERE id = $4 AND created_by = $5
       RETURNING id, name, muscles, category, created_by`,
      [name, muscles, category, id, userId],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "not_found_or_not_yours" });
      return;
    }

    const row = rows[0] as ExerciseRow;

    const { rows: favRows } = await pool.query(
      "SELECT 1 FROM user_favourite_exercises WHERE user_id = $1 AND exercise_id = $2",
      [userId, id],
    );

    res.json(
      formatExercise({ ...row, is_favourite: favRows.length > 0 }, userId),
    );
  } catch (err) {
    console.error("[exercises/update]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /exercises/:id — delete own exercise
// ---------------------------------------------------------------------------

exercisesRouter.delete("/exercises/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = (req as AuthRequest).auth.sub;

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM exercises WHERE id = $1 AND created_by = $2",
      [id, userId],
    );

    if (!rowCount) {
      res.status(404).json({ error: "not_found_or_not_yours" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("[exercises/delete]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/favourite — toggle favourite
// ---------------------------------------------------------------------------

exercisesRouter.post(
  "/exercises/:id/favourite",
  requireAuth,
  async (req, res) => {
    const { id } = req.params;
    const userId = (req as AuthRequest).auth.sub;

    const pool = getPool();
    if (!pool) {
      res.status(503).json({ error: "database_unavailable" });
      return;
    }

    try {
      // Verify exercise exists
      const { rows: exRows } = await pool.query(
        "SELECT id FROM exercises WHERE id = $1",
        [id],
      );
      if (exRows.length === 0) {
        res.status(404).json({ error: "exercise_not_found" });
        return;
      }

      // Toggle: insert if missing, delete if present
      const { rows: existing } = await pool.query(
        "SELECT 1 FROM user_favourite_exercises WHERE user_id = $1 AND exercise_id = $2",
        [userId, id],
      );

      let isFavourite: boolean;
      if (existing.length > 0) {
        await pool.query(
          "DELETE FROM user_favourite_exercises WHERE user_id = $1 AND exercise_id = $2",
          [userId, id],
        );
        isFavourite = false;
      } else {
        await pool.query(
          "INSERT INTO user_favourite_exercises (user_id, exercise_id) VALUES ($1, $2)",
          [userId, id],
        );
        isFavourite = true;
      }

      res.json({ exerciseId: id, isFavourite });
    } catch (err) {
      console.error("[exercises/favourite]", err);
      res.status(500).json({ error: "internal_error" });
    }
  },
);
