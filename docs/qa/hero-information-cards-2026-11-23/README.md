# Hero information cards ? 2026-11-23

Select the Hero Image inside a Layout Slider. Add up to two entries under Items, using the Site Media picker for each image. Configure alt text, optional eyebrow, title, description, link label and safe destination. Cards label adds the optional section badge. Set Layout Slider Height to Tall for a spacious sample-like composition.

Cards activate image-overlay presentation. Desktop places the first card left, heading/actions centrally, and second card right. Below 1100px available width cards stack; the fixed hero frame scrolls for long content, with keyboard-accessible scroll regions and links. Each card has an accessible close icon and a reopen button. Visibility is local component state, resets when the slide is remounted, and never changes stored content. Removing a card in the editor is an editorial change.

The same contract and renderer serve Main/child Sites and preview/public output. Card images are Site-validated and included in publication checks and database reference extraction. Existing media reference guards protect them. Migration 0034 applied locally; generated contract check passed. No existing drafts/publications were overwritten.

Tests: 16 backend comparison tests (including database card-reference extraction, bounded arrays, unsafe links and reference paths); 8 presentation tests; TypeScript passed. Browser script uses a read-only homepage response fixture and real comparison media at 390/768/1440px. Results and screenshots are adjacent. Reproduce with `node scripts/qa-hero-information-cards.cjs`.

Deployment: apply migration 0034 and rebuild/restart backend, admin-web and public-web.

Final verification: admin and public production builds passed; 12 presentation/carousel tests and 4 inspector tests passed. Browser runs at all three widths passed with zero automated WCAG scan violations and no horizontal overflow.

## Card toggles and colour swatches

Hero cards support independent close/reopen with Enter/Space, retained button focus and aria-expanded state. Inspector colours/tones use labelled visual swatches with pressed-state indication, gradient samples and a Default reset; approved token values and backend validation are unchanged. Nine presentation and five inspector tests passed; TypeScript passed. The browser script verifies independent closing, focus retention and reopening at all three widths.
