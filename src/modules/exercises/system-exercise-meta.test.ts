import { describe, expect, it, vi } from "vitest";
import { upsertBodySchema } from "./exercises.schemas.js";
import {
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  SYSTEM_EXERCISE_META,
  syncSystemExerciseMeta,
} from "./system-exercise-meta.js";

const ids = Object.keys(SYSTEM_EXERCISE_META);

describe("SYSTEM_EXERCISE_META", () => {
  it("covers all 96 system exercises", () => {
    expect(ids).toHaveLength(96);
    for (let n = 1; n <= 96; n++) {
      expect(ids).toContain(
        `a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      );
    }
  });

  it("uses only known equipment and movement patterns", () => {
    for (const meta of Object.values(SYSTEM_EXERCISE_META)) {
      expect(EQUIPMENT).toContain(meta.equipment);
      expect(MOVEMENT_PATTERNS).toContain(meta.pattern);
    }
  });

  it("has 3–5 steps and 2–3 common mistakes for every exercise", () => {
    for (const [id, meta] of Object.entries(SYSTEM_EXERCISE_META)) {
      const { steps, mistakes } = meta.instructions;
      expect(steps.length, id).toBeGreaterThanOrEqual(3);
      expect(steps.length, id).toBeLessThanOrEqual(5);
      expect(mistakes.length, id).toBeGreaterThanOrEqual(2);
      expect(mistakes.length, id).toBeLessThanOrEqual(3);
      for (const text of [...steps, ...mistakes]) {
        expect(text.length, id).toBeGreaterThan(5);
        expect(text.length, id).toBeLessThanOrEqual(300);
      }
    }
  });

  it("keeps aliases short and non-empty", () => {
    for (const [id, meta] of Object.entries(SYSTEM_EXERCISE_META)) {
      expect(meta.aliases.length, id).toBeGreaterThan(0);
      expect(meta.aliases.length, id).toBeLessThanOrEqual(10);
      for (const alias of meta.aliases) expect(alias.trim(), id).not.toBe("");
    }
  });
});

describe("syncSystemExerciseMeta", () => {
  it("sends aligned arrays and returns the changed count", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 3, rows: [] });
    const changed = await syncSystemExerciseMeta({ query } as never);
    expect(changed).toBe(3);
    const [idList, equipment, pattern, aliases, instructions] = query.mock
      .calls[0][1] as string[][];
    expect(idList).toEqual(ids);
    expect(equipment).toHaveLength(96);
    expect(pattern).toHaveLength(96);
    expect(JSON.parse(aliases[0]!)).toEqual(SYSTEM_EXERCISE_META[ids[0]!]!.aliases);
    expect(JSON.parse(instructions[0]!).steps.length).toBeGreaterThan(0);
  });
});

describe("upsertBodySchema details", () => {
  const base = { name: "Test", muscles: ["chest"], category: "compound" };

  it("accepts a body without the new fields (older clients)", () => {
    const parsed = upsertBodySchema.parse(base);
    expect(parsed.equipment).toBeUndefined();
    expect(parsed.aliases).toBeUndefined();
    expect(parsed.instructions).toBeUndefined();
  });

  it("accepts equipment, aliases and instructions and trims aliases", () => {
    const parsed = upsertBodySchema.parse({
      ...base,
      equipment: "dumbbell",
      aliases: [" db bench ", ""],
      instructions: { steps: ["Krok"], mistakes: [] },
    });
    expect(parsed.equipment).toBe("dumbbell");
    expect(parsed.aliases).toEqual(["db bench"]);
    expect(parsed.instructions?.steps).toEqual(["Krok"]);
  });

  it("stores empty instructions as null", () => {
    const parsed = upsertBodySchema.parse({
      ...base,
      instructions: { steps: [], mistakes: [] },
    });
    expect(parsed.instructions).toBeNull();
  });

  it("rejects unknown equipment", () => {
    expect(upsertBodySchema.safeParse({ ...base, equipment: "laser" }).success).toBe(false);
  });
});

describe("system exercise data fixes", () => {
  const at = (n: number) =>
    SYSTEM_EXERCISE_META[`a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`]!;

  it("gives hip adduction, dips, pullovers and skills their own patterns", () => {
    expect(at(91).pattern).toBe("hip_adduction");
    expect(at(7).pattern).toBe("dip");
    expect(at(77).pattern).toBe("dip");
    expect(at(81).pattern).toBe("pullover");
    expect(at(80).pattern).toBe("pullover");
    for (const n of [20, 24, 32]) expect(at(n).pattern).toBe("skill");
  });

  it("does not use stale aliases or clumsy wording", () => {
    const all = Object.values(SYSTEM_EXERCISE_META);
    const text = JSON.stringify(all);
    expect(text).not.toContain("kontrolowanie");
    expect(at(32).aliases).not.toContain("flaga przodem");
    expect(at(24).aliases).not.toContain("mus");
    expect(at(19).aliases).not.toContain("skipping");
  });
});
