import { z } from "zod";
import { postgresUuid } from "../../common/schemas.js";

export const GENDERS = ["male", "female", "other"] as const;
export const TRAINING_GOALS = ["strength", "muscle", "fat_loss", "general"] as const;
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;

/** 3–30 chars, lowercase letters/digits/`.`/`_`, starting with a letter or digit. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/;
export const MIN_USER_AGE = 16;
export const MAX_USER_AGE = 100;

/**
 * Full years between a `YYYY-MM-DD` birth date and [today] (UTC);
 * null when the string is not a real calendar day.
 */
export const ageOnDate = (isoDate: string, today: Date): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const todayMonth = today.getUTCMonth() + 1;
  const beforeBirthday =
    todayMonth < month || (todayMonth === month && today.getUTCDate() < day);
  return today.getUTCFullYear() - year - (beforeBirthday ? 1 : 0);
};

const nameField = (code: string) =>
  z.string({ error: code }).trim().min(1, code).max(50, code).optional();

// Profile details below: `null` clears the value, a missing key leaves it.
const enumField = <const T extends readonly [string, ...string[]]>(
  values: T,
  code: string,
) => z.enum(values, { error: code }).nullable().optional();

const intField = (min: number, max: number, code: string) =>
  z
    .number({ error: code })
    .int(code)
    .min(min, code)
    .max(max, code)
    .nullable()
    .optional();

export const profileUpdateSchema = z
  .object({
    firstName: nameField("invalid_first_name"),
    lastName: nameField("invalid_last_name"),
    bio: z
      .string()
      .trim()
      .max(120, "bio_too_long")
      .transform((value) => (value.length === 0 ? null : value))
      .optional(),
    handle: z
      .string({ error: "invalid_handle" })
      .trim()
      .toLowerCase()
      .regex(HANDLE_PATTERN, "invalid_handle")
      .optional(),
    birthDate: z
      .string({ error: "invalid_birth_date" })
      .refine((value) => {
        const age = ageOnDate(value, new Date());
        return age !== null && age >= MIN_USER_AGE && age <= MAX_USER_AGE;
      }, "invalid_birth_date")
      .nullable()
      .optional(),
    gender: enumField(GENDERS, "invalid_gender"),
    heightCm: intField(100, 250, "invalid_height"),
    weightKg: z
      .number({ error: "invalid_weight" })
      .min(30, "invalid_weight")
      .max(300, "invalid_weight")
      .transform((kg) => Math.round(kg * 10) / 10)
      .nullable()
      .optional(),
    trainingGoal: enumField(TRAINING_GOALS, "invalid_training_goal"),
    experienceLevel: enumField(EXPERIENCE_LEVELS, "invalid_experience_level"),
    weeklyTrainingDays: intField(1, 7, "invalid_weekly_training_days"),
  })
  .superRefine((data, ctx) => {
    if (Object.values(data).every((value) => value === undefined)) {
      ctx.addIssue({ code: "custom", message: "no_fields_to_update" });
    }
  });

export const profileListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const userSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const userIdParamsSchema = z.object({
  userId: postgresUuid,
});

export type Gender = (typeof GENDERS)[number];
export type TrainingGoal = (typeof TRAINING_GOALS)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ProfileListQuery = z.infer<typeof profileListQuerySchema>;
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;
