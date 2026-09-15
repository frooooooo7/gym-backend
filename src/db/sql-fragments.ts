/**
 * Shared SQL fragments for repositories. Keep them pure SQL text (no params)
 * so they can be embedded in any query.
 *
 * training_session_sets.actual_weight / actual_reps are TEXT (the client stores
 * the raw input), so only values that really are numbers are parsed: weights
 * accept a comma or dot decimal separator, reps must be a plain integer.
 * Anything else yields NULL (and contributes 0 to volume).
 */

/** Parsed weight as numeric, or NULL when the text is not a number. */
export const parsedWeightSql = (column: string): string =>
  `(CASE WHEN replace(btrim(${column}), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
         THEN replace(btrim(${column}), ',', '.')::numeric END)`;

/** Parsed reps as numeric, or NULL when the text is not an integer. */
export const parsedRepsSql = (column: string): string =>
  `(CASE WHEN btrim(${column}) ~ '^[0-9]+$' THEN btrim(${column})::numeric END)`;

/** Volume (weight × reps) of a single set, 0 when either part is unparsable. */
export const setVolumeSql = (weightColumn: string, repsColumn: string): string =>
  `COALESCE(${parsedWeightSql(weightColumn)} * ${parsedRepsSql(repsColumn)}, 0)`;

/** Session duration in whole seconds (open sessions count until now). */
export const sessionDurationSecSql = (alias: string): string =>
  `COALESCE(
     GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(${alias}.finished_at, now()) - ${alias}.started_at)))::int),
     0
   )`;

/**
 * Timestamp rendered with full microsecond precision (UTC, ISO 8601) — use it
 * for keyset cursors, because JS Dates truncate to milliseconds and a truncated
 * cursor would re-emit rows created within the same millisecond.
 */
export const cursorTimestampSql = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
