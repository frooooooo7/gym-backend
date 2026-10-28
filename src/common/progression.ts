import { z } from "zod";

export const PROGRESSION_METHODS = [
  "none",
  "fixed",
  "percent",
  "double",
  "rir",
] as const;

const step = (code: string) =>
  z.number({ error: code }).positive(code).max(50, code);

/**
 * How the app suggests the next weight. The step is kept in the unit the
 * user picked it in (5 lb stays 5 lb), so the app never shows 2.27 kg.
 * Missing fields take defaults, so a client may send only what it knows.
 */
export const progressionSettingsSchema = z
  .object({
    method: z.enum(PROGRESSION_METHODS, { error: "invalid_progression_method" }),
    unit: z.enum(["kg", "lb"], { error: "invalid_progression_unit" }).default("kg"),
    step: step("invalid_progression_step").default(2.5),
    /** Bigger step for leg exercises; null = same as [step]. */
    legStep: step("invalid_progression_leg_step").nullable().default(null),
    percent: z
      .number({ error: "invalid_progression_percent" })
      .positive("invalid_progression_percent")
      .max(20, "invalid_progression_percent")
      .default(2.5),
    rirThreshold: z
      .number({ error: "invalid_progression_rir" })
      .int("invalid_progression_rir")
      .min(1, "invalid_progression_rir")
      .max(5, "invalid_progression_rir")
      .default(2),
    sessionsToIncrease: z
      .number({ error: "invalid_progression_sessions" })
      .int("invalid_progression_sessions")
      .min(1, "invalid_progression_sessions")
      .max(3, "invalid_progression_sessions")
      .default(1),
    deload: z.boolean({ error: "invalid_progression_deload" }).default(false),
  }, { error: "invalid_progression" })
  .strip();

export type ProgressionSettings = z.infer<typeof progressionSettingsSchema>;

/** Stored JSON → settings; anything unreadable counts as not set. */
export const progressionOf = (stored: unknown): ProgressionSettings | null => {
  if (stored === null || stored === undefined) return null;
  const parsed = progressionSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
};
