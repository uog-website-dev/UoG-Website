import { describe, expect, it } from "vitest";

import { highContrastTheme, uogColors, uogTheme } from "./theme";

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[a-f\d]{2}/gi)!.slice(0, 3).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

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

  it("keeps approved institutional and high-contrast text pairs above WCAG AA", () => {
    const pairs = [
      [uogTheme.palette.primary.contrastText, uogTheme.palette.primary.main],
      [uogTheme.palette.secondary.contrastText, uogTheme.palette.secondary.main],
      [highContrastTheme.palette.primary.contrastText, highContrastTheme.palette.primary.main],
      [highContrastTheme.palette.secondary.contrastText, highContrastTheme.palette.secondary.main],
      [uogTheme.palette.text.primary, uogTheme.palette.background.default],
      [highContrastTheme.palette.text.primary, highContrastTheme.palette.background.default],
    ];
    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
