import { describe, expect, it } from "vitest";

import { uogColors, uogTheme } from "./theme";

describe("uogTheme", () => {
  it("uses the UoG navy as the primary brand colour", () => {
    expect(uogTheme.palette.primary.main).toBe(uogColors.navy);
  });

  it("uses the UoG gold as the secondary accent", () => {
    expect(uogTheme.palette.secondary.main).toBe(uogColors.gold);
  });

  it("renders on a light background", () => {
    expect(uogTheme.palette.mode).toBe("light");
  });
});
