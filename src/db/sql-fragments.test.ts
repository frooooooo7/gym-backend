import { describe, expect, it } from "vitest";
import { containsPattern } from "./sql-fragments.js";

describe("containsPattern", () => {
  it.each([
    ["bench", "%bench%"],
    ["100%", "%100\\%%"],
    ["a_b", "%a\\_b%"],
    ["back\\slash", "%back\\\\slash%"],
    ["", "%%"],
  ])("%j → %j", (input, expected) => {
    expect(containsPattern(input)).toBe(expected);
  });
});
