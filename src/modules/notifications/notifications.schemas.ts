import { z } from "zod";

export const NOTIFICATION_TYPES = [
  "kudos",
  "follow",
  "plan_copy",
  "record",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** `kudos:<sessionId>`, `follow:<userId>`, `plan_copy:<planId>`, `record:<sessionId>`. */
export const notificationParamsSchema = z.object({
  id: z
    .string()
    .regex(
      /^(kudos|follow|plan_copy|record):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "invalid_notification_id",
    ),
});

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalid_time");

const quietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  from: clockTime.default("22:00"),
  to: clockTime.default("07:00"),
});

/** Stored settings with defaults filled in; unknown keys are dropped. */
export const notificationSettingsSchema = z.object({
  kudos: z.boolean().default(true),
  follows: z.boolean().default(true),
  planCopies: z.boolean().default(true),
  records: z.boolean().default(true),
  quietHours: quietHoursSchema.default({
    enabled: false,
    from: "22:00",
    to: "07:00",
  }),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const updateNotificationSettingsSchema = z
  .object({
    kudos: z.boolean().optional(),
    follows: z.boolean().optional(),
    planCopies: z.boolean().optional(),
    records: z.boolean().optional(),
    quietHours: z
      .object({
        enabled: z.boolean().optional(),
        from: clockTime.optional(),
        to: clockTime.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UpdateNotificationSettingsBody = z.infer<
  typeof updateNotificationSettingsSchema
>;
