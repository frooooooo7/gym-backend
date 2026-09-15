import { requirePool } from "../../db/require-pool.js";
import { uniqueHandleFromId, handleBaseFromName } from "../profile/profile.handle.js";

export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  token_version: number;
}

export interface UserWithPasswordRow extends UserRow {
  password_hash: string;
}

export interface DeletedAccountFiles {
  avatarUrl: string | null;
  /** image_url of the user's custom exercises that were actually deleted. */
  exerciseImageUrls: string[];
}

const USER_COLUMNS = "id, email, first_name, last_name, token_version";

export const authRepository = {
  createUser: async (
    normalizedEmail: string,
    passwordHash: string,
    firstName: string,
    lastName: string,
  ): Promise<UserRow | null> => {
    const pool = requirePool();
    const handle = uniqueHandleFromId(handleBaseFromName(firstName, lastName), crypto.randomUUID());
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, handle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [normalizedEmail, passwordHash, firstName, lastName, handle],
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0] as UserRow;
  },

  findUserWithPasswordByEmail: async (
    normalizedEmail: string,
  ): Promise<UserWithPasswordRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
      [normalizedEmail],
    );
    return rows[0] as UserWithPasswordRow | undefined;
  },

  findUserWithPasswordById: async (
    id: string,
  ): Promise<UserWithPasswordRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] as UserWithPasswordRow | undefined;
  },

  findPublicUserById: async (id: string): Promise<UserRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] as UserRow | undefined;
  },

  /** `null` when the user does not exist. */
  findTokenVersion: async (id: string): Promise<number | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      "SELECT token_version FROM users WHERE id = $1",
      [id],
    );
    if (rows.length === 0) return null;
    return Number(rows[0].token_version);
  },

  /**
   * Sets the new hash and bumps token_version — only if the stored hash is
   * still the one the caller verified (a concurrent change wins, we get null).
   */
  updatePasswordAndBumpTokenVersion: async (
    id: string,
    expectedPasswordHash: string,
    newPasswordHash: string,
  ): Promise<UserRow | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE users
       SET password_hash = $3, token_version = token_version + 1
       WHERE id = $1 AND password_hash = $2
       RETURNING ${USER_COLUMNS}`,
      [id, expectedPasswordHash, newPasswordHash],
    );
    return (rows[0] as UserRow | undefined) ?? null;
  },

  bumpTokenVersion: async (id: string): Promise<UserRow | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `UPDATE users SET token_version = token_version + 1
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [id],
    );
    return (rows[0] as UserRow | undefined) ?? null;
  },

  /**
   * Deletes the user and everything they own in one transaction.
   *
   * FK order matters: `training_plan_exercises.exercise_id` is ON DELETE
   * RESTRICT and `exercises.created_by` is ON DELETE SET NULL, so:
   *   1. lock the user row (blocks concurrent inserts referencing the user),
   *   2. delete their plans (cascades plan exercises/sets),
   *   3. delete their custom exercises that no remaining plan references —
   *      plans only accept system or own exercises, so a foreign reference can
   *      only come from legacy data; such exercises are kept and end up with
   *      `created_by = NULL` via the users FK,
   *   4. delete the user (cascades sessions, favourites, follows, kudos,
   *      comments, tombstones).
   * Returns null when the user does not exist.
   */
  deleteUserCascade: async (
    id: string,
  ): Promise<DeletedAccountFiles | null> => {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: userRows } = await client.query(
        "SELECT avatar_url FROM users WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (userRows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query("DELETE FROM training_plans WHERE user_id = $1", [id]);

      const { rows: exerciseRows } = await client.query(
        `DELETE FROM exercises e
         WHERE e.created_by = $1
           AND e.is_system = false
           AND NOT EXISTS (
             SELECT 1 FROM training_plan_exercises tpe WHERE tpe.exercise_id = e.id
           )
         RETURNING e.image_url`,
        [id],
      );

      await client.query("DELETE FROM users WHERE id = $1", [id]);
      await client.query("COMMIT");

      return {
        avatarUrl: (userRows[0].avatar_url as string | null) ?? null,
        exerciseImageUrls: exerciseRows
          .map((row) => row.image_url as string | null)
          .filter((url): url is string => !!url),
      };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  },
};
