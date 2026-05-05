import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";
import { authRepository, type UserRow } from "./auth.repository.js";

const SALT_ROUNDS = 12;
const TOKEN_TTL = "30d";

export const DUMMY_HASH = await bcrypt.hash(
  "__timing_guard_dummy__",
  SALT_ROUNDS,
);

const makeToken = (id: string, email: string): string =>
  jwt.sign({ sub: id, email }, env.jwtSecret, { expiresIn: TOKEN_TTL });

const formatUser = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
});

export const authService = {
  register: async (
    input: RegisterInput,
  ): Promise<{ token: string; user: ReturnType<typeof formatUser> }> => {
    const { email, password, firstName, lastName } = input;
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await authRepository.createUser(
      normalizedEmail,
      passwordHash,
      firstName,
      lastName,
    );

    if (!user) {
      throw new AppError(409, "email_taken");
    }

    return {
      token: makeToken(user.id, user.email),
      user: formatUser(user),
    };
  },

  login: async (
    input: LoginInput,
  ): Promise<{ token: string; user: ReturnType<typeof formatUser> }> => {
    const normalizedEmail = input.email.toLowerCase();
    const user = await authRepository.findUserWithPasswordByEmail(
      normalizedEmail,
    );

    const hashToCompare = user?.password_hash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(input.password, hashToCompare);

    if (!user || !valid) {
      throw new AppError(401, "invalid_credentials");
    }

    return {
      token: makeToken(user.id, user.email),
      user: formatUser(user),
    };
  },

  getMe: async (userId: string): Promise<ReturnType<typeof formatUser>> => {
    const user = await authRepository.findPublicUserById(userId);
    if (!user) {
      throw new AppError(404, "user_not_found");
    }
    return formatUser(user);
  },
};
