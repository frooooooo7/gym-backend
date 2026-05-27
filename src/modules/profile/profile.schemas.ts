import { z } from "zod";
import { postgresUuid } from "../../common/schemas.js";
import { isValidHandle, normalizeHandle } from "./profile.handle.js";

const optionalBio = z
  .string()
  .trim()
  .max(120, "bio_too_long")
  .transform((value) => (value.length === 0 ? null : value))
  .optional();

export const profileUpdateSchema = z
  .object({
    bio: optionalBio,
    firstName: z
      .string()
      .trim()
      .min(1, "first_name_required")
      .max(50, "first_name_too_long")
      .optional(),
    lastName: z
      .string()
      .trim()
      .min(1, "last_name_required")
      .max(50, "last_name_too_long")
      .optional(),
    handle: z.string().trim().max(50, "handle_too_long").optional(),
  })
  .superRefine((data, ctx) => {
    const hasField =
      data.bio !== undefined ||
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.handle !== undefined;
    if (!hasField) {
      ctx.addIssue({ code: "custom", message: "empty_update" });
    }

    if (data.handle === undefined) return;

    const normalized = normalizeHandle(data.handle);
    if (!isValidHandle(normalized)) {
      ctx.addIssue({ code: "custom", message: "handle_invalid" });
    }
  })
  .transform((data) => ({
    bio: data.bio,
    firstName: data.firstName,
    lastName: data.lastName,
    handle:
      data.handle !== undefined ? normalizeHandle(data.handle) : undefined,
  }));

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
