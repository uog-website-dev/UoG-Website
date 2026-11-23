# Mobile header and footer chrome

The public header and footer share one responsive composition between Main and child Sites and between the public application and admin previews.

## Header

- Below `lg` the utility menu no longer renders as its own horizontal row. Utility links and the configured call to action appear in the mobile navigation drawer, below the header menu.
- The mobile header is one row with a 64 px minimum height (`min-height: 64px`, measured 70.4 px including the 3 px brand border at 390 px). The logo mark is 40 px inside a 44 px brand link, the Site name stays on one line and fits in full at 390 px, and the menu/search controls are 44 × 44 px. The regular layout, full-size logo and utility row return at `lg`; the desktop header is unchanged.
- The drawer includes a "Site utility" section and a "Quick links" action when a CTA is configured. Its content respects `env(safe-area-inset-bottom)`.
- The current-page indicator is now an underline on the label itself, instead of a border below a 44 px link inside a taller navigation bar, so it sits on the label baseline rather than mid-header.

## Footer

- Columns are accordions below `md`: collapsed by default, each heading a native button with `aria-expanded` and `aria-controls`, plus a 48 px touch target and a visible focus ring. Escape closes an open column.
- At `sm` the column grid is two columns; from `md` it uses the configured column count (up to four). The brand/contact region remains a separate block.
- Groups with more than six links show the first six and a "More {group} links" disclosure with `aria-expanded`/`aria-controls`; the control switches to "Show fewer {group} links".
- The footer logo shrinks to 96 px on phones, the outer padding is reduced, and the bottom edge reserves `env(safe-area-inset-bottom)`. A floating support link sits above the safe area.
- Footer heading links and descriptions remain unchanged on desktop.

## Motion and accessibility

- Disclosure icons keep a short rotation on desktop and remove it under `prefers-reduced-motion: reduce`. `apps/public-web/src/app/globals.css` also reduces all animation/transition durations for visitors who request reduced motion.
- All interactive chrome targets measure at least 44 px. `:focus-visible` outlines are defined for drawer triggers, drawer close, menu links, accordion buttons, "More" disclosures and footer links.

## Measurements

Measured in the local public application with a Site that has four footer columns, collapsed by default:

| Width | Header height | Footer height (collapsed) | Horizontal overflow |
| --- | --- | --- | --- |
| 320 px | 70.4 px | 865.9 px | none |
| 360 px | 70.4 px | 816.2 px | none |
| 390 px | 70.4 px | 816.2 px | none |
| 430 px | 70.4 px | 816.2 px | none |

The reported pre-change values at 390×844 were 170 px for the header and 1573 px for the footer. The footer figure varies with the Site's contact/social content; the four column groups here are closed. The desktop header keeps the full Site title (measured 204 px wide at 1280 px, not clipped); the earlier mobile CSS accidentally constrained the title as well as the logo and is fixed.

Screenshots: `docs/qa/mobile-chrome-header-390.png` (compact header) and `docs/qa/mobile-footer-390.png` (collapsed accordion footer). The header measurement is unaffected by the Freebuff browser overlay; the overlay is not part of the page.

## Verification

- `packages/ui/src/site-navigation.test.tsx`: utility links and the quick action open inside the mobile drawer, with expanded state.
- `packages/ui/src/public-site-header.test.tsx`: one compact row marker, utility links and CTA reachable in the drawer.
- `packages/ui/src/site-footer.test.tsx`: columns collapsed by default, `aria-expanded`/`aria-controls`, click and Escape keyboard behaviour, More/Show fewer disclosure, public heading/description.
- `packages/ui/src/public-page.test.tsx`, `public-site-header.test.tsx`, `site-navigation.test.tsx` and admin header/menu-preview tests remain green; UI/public/admin typecheck passes.
- Real-browser check at 320, 360, 390 and 430 px: no horizontal overflow, header 70.4 px at every width, footer columns collapsed; opening the drawer exposes the header navigation; keyboard Enter expands a footer column and Escape collapses it with `aria-expanded` updated; every chrome link/button measured at least 44 px; a keyboard-focused accordion heading shows a visible focus outline.

The full UI suite still reports two unrelated pre-existing failures (`visual-presentation.test.tsx` hero semantics and `carousel-presentation.test.tsx` AAU comparison layout validation); neither touches header/footer/navigation code. A full manual screen-reader pass and the Keycloak-authenticated visual-regression run remain owner/QA actions.
