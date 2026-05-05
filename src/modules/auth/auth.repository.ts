import { requirePool } from "../../db/require-pool.js";

export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface UserWithPasswordRow extends UserRow {
  password_hash: string;
}

export const authRepository = {
  createUser: async (
    normalizedEmail: string,
    passwordHash: string,
    firstName: string,
    lastName: string,
  ): Promise<UserRow | null> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, first_name, last_name`,
      [normalizedEmail, passwordHash, firstName, lastName],
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
      "SELECT id, email, password_hash, first_name, last_name FROM users WHERE email = $1",
      [normalizedEmail],
    );
    return rows[0] as UserWithPasswordRow | undefined;
  },

  findPublicUserById: async (id: string): Promise<UserRow | undefined> => {
    const pool = requirePool();
    const { rows } = await pool.query(
      "SELECT id, email, first_name, last_name FROM users WHERE id = $1",
      [id],
    );
    return rows[0] as UserRow | undefined;
  },
};
