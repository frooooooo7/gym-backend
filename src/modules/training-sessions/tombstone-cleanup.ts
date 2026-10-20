import { logger, serializeError } from "../../common/logger.js";
import { getPool } from "../../db/pool.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tombstones stop offline clients from resurrecting deleted workouts, so they
 * must outlive the longest offline period we support. After that a queued
 * upload of a deleted session is improbable enough to accept, and the table
 * stops growing forever. `TOMBSTONE_RETENTION_DAYS=0` disables the cleanup.
 */
export const tombstoneRetentionDays = (raw = process.env.TOMBSTONE_RETENTION_DAYS): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 365;
};

/** Deletes tombstones older than the retention window; returns how many. */
export const purgeOldTombstones = async (retentionDays: number): Promise<number> => {
  const pool = getPool();
  if (!pool || retentionDays <= 0) return 0;
  const { rowCount } = await pool.query(
    `DELETE FROM training_session_tombstones
     WHERE deleted_at < now() - make_interval(days => $1)`,
    [retentionDays],
  );
  return rowCount ?? 0;
};

/**
 * Runs the purge shortly after start and then daily. The timer is unref'd,
 * so it never keeps the process alive; with several instances each runs it —
 * the DELETE is idempotent.
 */
export const scheduleTombstoneCleanup = (): (() => void) => {
  const retentionDays = tombstoneRetentionDays();
  if (retentionDays <= 0) return () => undefined;

  const run = () => {
    purgeOldTombstones(retentionDays).then(
      (deleted) => {
        if (deleted > 0) {
          logger.info("[tombstones] purged", { deleted, retentionDays });
        }
      },
      (err: unknown) => {
        logger.warn("[tombstones] cleanup failed", { error: serializeError(err) });
      },
    );
  };

  const first = setTimeout(run, 60_000);
  const daily = setInterval(run, DAY_MS);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
};
