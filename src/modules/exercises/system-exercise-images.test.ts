import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SYSTEM_EXERCISE_IMAGES,
  syncSystemExerciseImages,
} from "./system-exercise-images.js";

const imagesDir = path.join(process.cwd(), "public", "exercise-images");
const slugs = Object.values(SYSTEM_EXERCISE_IMAGES);

describe("SYSTEM_EXERCISE_IMAGES", () => {
  it("uses URL-safe, unique slugs", () => {
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a bundled file for every slug and no unused files", () => {
    const files = fs
      .readdirSync(imagesDir)
      .filter((f) => f.endsWith(".webp"))
      .sort();
    expect(files).toEqual(slugs.map((s) => `${s}.webp`).sort());
  });
});

describe("syncSystemExerciseImages", () => {
  it("passes ids and URLs as aligned parameters", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 5 }] });

    const result = await syncSystemExerciseImages({ query } as never);

    expect(result).toEqual({ exercises: 2, sessionExercises: 5 });
    const [ids, urls, prefix] = query.mock.calls[0][1] as [
      string[],
      string[],
      string,
    ];
    expect(ids).toEqual(Object.keys(SYSTEM_EXERCISE_IMAGES));
    expect(urls[0]).toBe(`/static/exercise-images/${slugs[0]}.webp`);
    expect(urls).toHaveLength(ids.length);
    expect(prefix).toBe("/static/exercise-images/");
    expect(query.mock.calls[1][1]).toEqual([ids, prefix]);
  });
});
