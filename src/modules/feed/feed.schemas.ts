import { z } from "zod";
import { postgresUuid } from "../../common/schemas.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decoded keyset cursor: timestamp (ISO, up to µs precision) + row id. */
export interface KeysetCursor {
  at: string;
  id: string;
}

/**
 * Opaque base64url JSON cursor (same style as training-history), keyed by the
 * ordering timestamp name so feed and comment cursors are not interchangeable.
 */
const createCursorCodec = (timeKey: "startedAt" | "createdAt") => {
  const payloadSchema = z.object({
    [timeKey]: z.string().datetime({ offset: true }),
    id: z.string().regex(UUID_PATTERN),
  });
  return {
    encode: (at: string, id: string): string =>
      Buffer.from(JSON.stringify({ [timeKey]: at, id }), "utf8").toString(
        "base64url",
      ),
    /** Throws on malformed input. */
    decode: (cursor: string): KeysetCursor => {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const parsed = payloadSchema.parse(JSON.parse(decoded)) as Record<
        string,
        string
      >;
      return { at: parsed[timeKey], id: parsed.id };
    },
  };
};

export const feedCursor = createCursorCodec("startedAt");
export const commentCursor = createCursorCodec("createdAt");

const cursorQuery = (codec: ReturnType<typeof createCursorCodec>) =>
  z
    .string()
    .optional()
    .transform((value, ctx): KeysetCursor | undefined => {
      const trimmed = value?.trim() ?? "";
      if (trimmed.length === 0) return undefined;
      try {
        return codec.decode(trimmed);
      } catch {
        ctx.addIssue({ code: "custom", message: "invalid_cursor" });
        return z.NEVER;
      }
    });

const limitQuery = (max: number, defaultValue: number) =>
  z.coerce
    .number({ error: "invalid_limit" })
    .int("invalid_limit")
    .min(1, "invalid_limit")
    .max(max, "invalid_limit")
    .default(defaultValue);

export const feedQuerySchema = z.object({
  limit: limitQuery(50, 20),
  cursor: cursorQuery(feedCursor),
});

export const commentsQuerySchema = z.object({
  limit: limitQuery(100, 30),
  cursor: cursorQuery(commentCursor),
});

export const kudosListQuerySchema = z.object({
  limit: limitQuery(100, 50),
  offset: z.coerce
    .number({ error: "invalid_offset" })
    .int("invalid_offset")
    .min(0, "invalid_offset")
    .default(0),
});

export const suggestedUsersQuerySchema = z.object({
  limit: limitQuery(30, 10),
});

export const postParamsSchema = z.object({
  sessionId: postgresUuid,
});

export const commentParamsSchema = z.object({
  sessionId: postgresUuid,
  commentId: postgresUuid,
});

/** Length is counted in code points, matching Postgres char_length(). */
export const createCommentBodySchema = z.object(
  {
    body: z
      .string({ error: "invalid_comment_body" })
      .trim()
      .refine((value) => {
        const length = Array.from(value).length;
        return length >= 1 && length <= 500;
      }, "invalid_comment_body"),
  },
  { error: "invalid_comment_body" },
);

export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type CommentsQuery = z.infer<typeof commentsQuerySchema>;
export type KudosListQuery = z.infer<typeof kudosListQuerySchema>;
export type SuggestedUsersQuery = z.infer<typeof suggestedUsersQuerySchema>;
export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;
