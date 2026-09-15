/** Postgres `foreign_key_violation` (e.g. referenced row deleted mid-request). */
export const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "23503";
