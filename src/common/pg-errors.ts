/** Postgres `foreign_key_violation` (e.g. referenced row deleted mid-request). */
export const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "23503";

/** Postgres `unique_violation`, optionally narrowed to one constraint/index. */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "23505" &&
  (constraint === undefined ||
    (error as { constraint?: unknown }).constraint === constraint);
