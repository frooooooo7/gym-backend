/**
 * Minimal structured logger (no dependency).
 *
 * - `NODE_ENV=production` → one JSON object per line (`time`, `level`, `msg`, ...fields).
 * - otherwise → compact text: `HH:MM:SS.mmm LEVEL msg key=value ...`.
 * - `LOG_LEVEL` = debug | info | warn | error | silent (default `info`,
 *   and `silent` when running under Vitest / `NODE_ENV=test`).
 *
 * Level and format are resolved lazily on each call, so the logger can be
 * imported before `dotenv` has populated `process.env`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

let sink: LogSink = defaultSink;

/** Test hook: redirect log lines (pass `null` to restore stdout/stderr). */
export const setLogSink = (next: LogSink | null): void => {
  sink = next ?? defaultSink;
};

const isTestRun = (): boolean =>
  process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

export const resolveLogLevel = (): LogLevel | "silent" => {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && raw in LEVEL_RANK) return raw as LogLevel | "silent";
  return isTestRun() ? "silent" : "info";
};

export const isJsonLogFormat = (): boolean =>
  process.env.NODE_ENV === "production";

/** Errors as plain objects — for logs only, never for HTTP responses. */
export const serializeError = (err: unknown): LogFields => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
};

const formatTextValue = (value: unknown): string => {
  if (typeof value === "string") {
    return /[\s="]/.test(value) ? JSON.stringify(value) : value;
  }
  if (value instanceof Error) return JSON.stringify(serializeError(value));
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const textTime = (d: Date): string => d.toISOString().slice(11, 23);

const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
  if (LEVEL_RANK[level] < LEVEL_RANK[resolveLogLevel()]) return;
  const now = new Date();
  const clean: LogFields = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) clean[key] = value instanceof Error ? serializeError(value) : value;
  }

  if (isJsonLogFormat()) {
    sink(JSON.stringify({ time: now.toISOString(), level, msg, ...clean }), level);
    return;
  }

  const stack = typeof (clean.error as LogFields | undefined)?.stack === "string"
    ? `\n${(clean.error as LogFields).stack as string}`
    : "";
  const pairs = Object.entries(clean)
    .map(([key, value]) => `${key}=${formatTextValue(value)}`)
    .join(" ");
  sink(
    `${textTime(now)} ${level.toUpperCase().padEnd(5)} ${msg}${pairs ? ` ${pairs}` : ""}${stack}`,
    level,
  );
};

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
