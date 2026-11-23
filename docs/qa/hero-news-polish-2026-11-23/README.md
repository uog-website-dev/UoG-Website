# Hero and news presentation QA — 2026-11-23

Shared implementation applies to Main and child Sites in builder, preview and public rendering.

## Editor controls

- Layout Slider: Height (compact, medium, tall or screen), navigation style and autoplay interval. Height governs every slide, including slides without images. Images crop with the existing focal position. Long copy remains scrollable by keyboard.
- Hero Image: split orientation, media ratio (40/60, 50/50, 60/40), panel tone (inherit, light, brand, dark), and background pattern (none, heritage, grid). Patterns are fixed approved artwork; arbitrary CSS is not accepted.
- Loop Grid: Display = Slider enables horizontal cards; Columns controls desktop visible cards. Existing source, category, limit and Site scope remain unchanged. Image hover can be disabled.
- Presentation settings appear before the ordered item editor. Existing documents retain valid defaults and stable item IDs.

Visible carousel controls use arrows and dots without a numeric counter. A screen-reader counter remains, and autoplay pause is available on keyboard focus. Hover, focus, hidden tabs and reduced-motion preferences suspend rotation. News images zoom inside clipped frames; reduced motion disables animation.

## Verification

- Browser: `node scripts/qa-hero-news-polish.cjs` against the real local AAU comparison Site. All five current slides retained identical stage height: 640px at 390px viewport and 480px at 768px/1440px. No document overflow. Automated WCAG A/AA scans reported zero violations at each width; this is not a complete accessibility certification.
- Horizontal news checks use a read-only intercepted homepage response that changes only the Loop Grid display option. Real Site-scoped news/media endpoints supply cards. No draft, publication or configuration was overwritten. Arrow scrolling, contained hover and reduced-motion checks passed.
- Screenshots and detailed viewport results are beside this file.
- Shared UI: 30 tests passed (carousel, presentation, horizontal cards, widget runtime and public posts). Inspector: 4 tests passed. Admin TypeScript passed.
- Backend contract/comparison suite: 123 tests passed; additional updated comparison validation run: 10 passed. New properties reject unknown pattern/tone/ratio values.
- Generated contract consistency check passed. Migration 0032 installs the frozen schema for the approved presentation properties and was applied locally.

## Deployment

Apply CMS migration 0032 and rebuild/restart backend, admin-web and public-web so imported schemas and shared components refresh. Existing Page content is retained. The local browser evidence uses development services; production compilation is validated separately and is not a production latency benchmark.

Admin and public optimized production builds passed. Django reports no missing model migrations; whitespace validation passed. Local admin service restarted to expose the updated inspector.
