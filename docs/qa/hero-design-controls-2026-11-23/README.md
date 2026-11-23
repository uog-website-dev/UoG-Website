# Hero design controls — 2026-11-23

Select the Hero Image inside a Layout Slider, then configure its properties:

- Pattern: heritage, grid, dots, diagonal, waves, diamonds, or none.
- Panel tone: inherit, light, brand, dark, mist, gold, brand gradient, dark gradient.
- Mask: curve enables curved image edge; curve border offers none, white, gold or brand, with 4/8/12px accent width. Split-reverse mirrors the curve. Mobile stacks the image without the desktop curve.
- Heading level: H1–H4; visual size is configured separately. Prefer one H1 per Page.
- Heading: approved colour, weight, normal/uppercase, and size.
- Text: shared alignment and paragraph size.

All options are allowlisted schema tokens shared by backend, inspector, preview and public output. Existing documents keep defaults. Custom CSS/HTML is not accepted. Choose contrasting heading colours; white is intended for dark/brand panels, dark/brand for light panels. No existing content was overwritten.

Migration 0033 applied locally. Generated-contract check and TypeScript passed. Backend comparison tests: 14 passed. Presentation tests: 4 passed; existing carousel tests: 4 passed. Browser fixture exercises a gold curved edge, brand gradient and uppercase heading with real comparison media at 390/768/1440 widths. The fixture is a read-only response override, not a published content edit. Viewport results and screenshots accompany this file. Automated accessibility scans are limited checks, not certification.

Reproduce: `node scripts/qa-hero-design-controls.cjs`. Restart schema consumers and rebuild services when deploying.

## Review fixes

Explicit formatting now activates the shared presentation renderer on legacy heroes without changing untouched legacy documents. Split panel tones/gradients are painted behind the whole hero so the curved edge meets the selected tone in both orientations. Regression tests cover legacy formatting and both curve orientations: 11 focused presentation/carousel tests passed; TypeScript passed. Browser matrix rerun passed at 390, 768 and 1440px with no overflow or automated accessibility violations.
