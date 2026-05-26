import { z } from "zod";
import { postgresUuid } from "../../common/schemas.js";

export const profileUpdateSchema = z.object({
  bio: z
    .string()
    .trim()
    .max(120, "bio_too_long")
    .transform((value) => (value.length === 0 ? null : value)),
});

export const profileListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const profileActivitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const userSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const userIdParamsSchema = z.object({
  userId: postgresUuid,
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ProfileListQuery = z.infer<typeof profileListQuerySchema>;
export type ProfileActivitiesQuery = z.infer<typeof profileActivitiesQuerySchema>;
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;
