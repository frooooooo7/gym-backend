import { describe, expect, it } from "vitest";
import { ageOnDate } from "./profile.schemas.js";

const TODAY = new Date(Date.UTC(2026, 8, 23)); // 2026-09-23

describe("ageOnDate", () => {
  it.each([
    ["2010-09-23", 16], // birthday today
    ["2010-09-24", 15], // birthday tomorrow
    ["2010-10-01", 15],
    ["2010-08-31", 16],
    ["1926-09-23", 100],
    ["1926-09-24", 99],
    ["2000-02-29", 26], // leap day
  ])("%s → %i", (birthDate, age) => {
    expect(ageOnDate(birthDate, TODAY)).toBe(age);
  });

  it.each(["2001-02-29", "2001-13-01", "2001-00-10", "2001-1-5", "5.03.1998", ""])(
    "%j is not a calendar day",
    (value) => {
      expect(ageOnDate(value, TODAY)).toBeNull();
    },
  );
});
