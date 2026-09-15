// Shared helpers for the end-to-end smoke scripts (real server + real Postgres).
//
// Env:
//   BASE               API origin, e.g. http://localhost:3101
//   API_PREFIX         "" (legacy unprefixed paths, default) or "/api/v1"
//   DATABASE_URL       same database the server uses (needed by scripts that
//                      inspect rows directly: sessions.mjs, account.mjs)
//   SMOKE_BACKEND_DIR  directory the server runs in (its ./uploads is checked
//                      on disk by account.mjs); defaults to the repo root
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const BASE = process.env.BASE ?? "http://localhost:3101";
export const API_PREFIX = (process.env.API_PREFIX ?? "").replace(/\/+$/, "");
export const BACKEND_DIR =
  process.env.SMOKE_BACKEND_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Applies API_PREFIX to an API path. Paths that are already absolute API
 * paths (`/api/...`) or static files (`/uploads/...`) are left untouched.
 */
export const apiPath = (p) =>
  p.startsWith("/api/") || p.startsWith("/uploads/") ? p : `${API_PREFIX}${p}`;

let client = null;

/**
 * Runs one SQL statement and returns its output formatted like
 * `psql -tAc`: raw Postgres text values, `|` between columns, newline
 * between rows, NULL as an empty string.
 */
export const sql = async (query) => {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for smoke checks that query the database");
    }
    client = new pg.Client({
      connectionString,
      // Keep every value as Postgres text, exactly as psql prints it.
      types: { getTypeParser: () => (value) => value },
    });
    await client.connect();
  }
  const result = await client.query({ text: query, rowMode: "array" });
  return (result.rows ?? [])
    .map((row) => row.map((v) => (v === null ? "" : String(v))).join("|"))
    .join("\n")
    .trim();
};

export const closeDb = async () => {
  if (client) {
    await client.end().catch(() => undefined);
    client = null;
  }
};
