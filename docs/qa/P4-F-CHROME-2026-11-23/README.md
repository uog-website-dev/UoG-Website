# P4-F-CHROME — Public site chrome and Visual Builder hardening

Date: **2026-11-23**.

Review type: read-only review of the rendered public homepages plus the header,
menu, footer and Visual Builder implementations for the Main Site and child
Sites. **No product code, schema, content, configuration or repository file was
changed by the review itself.** Only temporary browser scripts and screenshots
were written outside the repository.

This folder converts the review findings into Azure DevOps-ready user stories
using the approved P4 story template (User story, Business context,
Implementation requirements, Acceptance criteria, Required tests / evidence,
Dependencies / prerequisites, Definition of Done).

> **ID note:** `P4-F-CHROME` and `P4-F-CHROME-01` … `P4-F-CHROME-09` are
> **proposed** backlog references, not existing Azure DevOps work-item IDs.
> Create the feature and its child stories in Azure DevOps, then record the real
> IDs here.

## Epic

**P4-F-CHROME — Professional, configurable and safe public site chrome**

**Business context**

The review found a strong technical foundation — typed footer settings, a
capable menu engine, safe link handling, a tested Visual Builder — but unsafe
defaults and split ownership in the public chrome:

- visual pages hide their only `h1` while the builder reports the title as
  visible;
- “Full width” is the default and removes every page gutter;
- the footer is configurable but the header is hard-coded;
- the builder can place site-logo, site-title and menu widgets inside page
  content, duplicating the global chrome;
- internal menu names and QA fixture text reach public footer headings.

**Business outcome:** every Main or child Site can publish a professional,
accessible, configurable header, menu and footer without developer assistance,
and the Visual Builder cannot produce a structurally broken page.

## Scope

In scope:

- public header, utility navigation, header menu, search entry point and footer
  on the Main Site and all child Sites;
- the Visual Builder page settings and palette as they affect site chrome and
  page structure;
- Site administration screens for Menus, Footer, Appearance and the missing
  Header configuration;
- publish/preview governance for chrome settings;
- mobile composition of the header and footer.

Out of scope for this feature: new public routes, a second publishing workflow,
custom CSS/JavaScript, and any change to the Post workflow.

## Story index

| ID | Title | Source findings | Severity |
| --- | --- | --- | --- |
| [P4-F-CHROME-01](P4-F-CHROME-01.md) | One visible H1 and correct heading semantics | P0-1 | P0 |
| [P4-F-CHROME-02](P4-F-CHROME-02.md) | Safe page width, gutters and explicit bleed | P0-2 | P0 |
| [P4-F-CHROME-03](P4-F-CHROME-03.md) | Header settings with live preview | P0-3 | P0 |
| [P4-F-CHROME-04](P4-F-CHROME-04.md) | Separate site chrome from page canvas | P0-4 | P0 |
| [P4-F-CHROME-05](P4-F-CHROME-05.md) | Public labels and publish gate for chrome | P0-5, P1-9 | P0 |
| [P4-F-CHROME-06](P4-F-CHROME-06.md) | Mobile header and footer compaction | P1-6, P1-7 | P1 |
| [P4-F-CHROME-07](P4-F-CHROME-07.md) | Server-delivered navigation and CLS protection | P1-8 | P1 |
| [P4-F-CHROME-08](P4-F-CHROME-08.md) | Professional appearance and university affordances | P1-11, P1-12 | P1 |
| [P4-F-CHROME-09](P4-F-CHROME-09.md) | Complete the remaining chrome audit | Remaining audit | P1/P2 |

Each story file is a paste-ready Azure DevOps issue body. Set its parent to the
`P4-F-CHROME` feature and keep the proposed ID in the title until the real ID is
assigned.

## Evidence base

Reviewed surfaces: `www.uog.local` (Main), `caes.uog.local`, `coi.uog.local`,
and the empty-homepage fallback on `cmhs.uog.local`, at 1440×900 and 390×844 in
a real Edge browser, plus the corresponding source paths.

| Finding | Evidence | Story |
| --- | --- | --- |
| P0-1 — visual pages hide their only `h1`; the builder reports the title as visible | `frontend/apps/public-web/src/app/page.tsx:41`; `frontend/packages/ui/src/public-page.tsx:422`; hero default `h2` at `frontend/packages/ui/src/visual-presentation.tsx:116`; live DOM: single `h1#public-page-title` with `clip-path: inset(50%)` | 01 |
| P0-2 — full-width is the default and removes gutters | `frontend/apps/admin-web/src/sites/visual-builder.tsx:1097`; `frontend/packages/ui/src/public-page.tsx:438`; `frontend/apps/public-web/src/public-site.tsx:53`; measured at 1440 px: container/article/first row `x=0`, width `1440`, padding `0` | 02 |
| P0-3 — header is not configurable while the footer is | `frontend/apps/admin-web/src/sites/site-admin.ts:20-84` (no Header section); `frontend/apps/public-web/src/public-menus.tsx:45-51` (hard-coded composition); `frontend/apps/admin-web/src/sites/site-appearance.tsx:70-80` (title, logo, theme only) | 03 |
| P0-4 — builder can duplicate global chrome inside page content | `frontend/apps/admin-web/src/sites/visual-builder-model.ts:18` palette includes `site_logo`, `site_title`, `menu`, `breadcrumbs`; automatic in-article lockup at `frontend/packages/ui/src/public-page.tsx:447`; observed brand three times and two `h1` elements | 04 |
| P0-5 — internal/QA names reach public copy; footer saves immediately | `frontend/apps/admin-web/src/sites/menu-locations.tsx:52`; `frontend/packages/ui/src/site-footer.tsx:50-52`; `frontend/apps/admin-web/src/sites/site-footer-panel.tsx:84`; observed headings “University Main - Footer”, “Main review mainqa-8995d437 University resources” | 05 |
| P1-6 — mobile chrome is too tall | measured at 390×844: header `170 px`, footer `1 573 px`; `frontend/packages/ui/src/site-footer.tsx:71` stacks every group on `xs` | 06 |
| P1-7 — active nav indicator floats mid-header | `frontend/packages/ui/src/site-navigation.tsx:150` triggers use `minHeight: 60` inside a `104 px` header | 06 |
| P1-8 — menus load after hydration | `frontend/apps/public-web/src/public-menus.tsx:27-41` fetches menus after mount | 07 |
| P1-9 — footer heading is coupled to the internal menu name | `frontend/apps/admin-web/src/sites/menu-locations.tsx:52`; `frontend/packages/ui/src/site-footer.tsx:50-52` | 05 |
| P1-11 — appearance is too thin for a university site | `frontend/apps/admin-web/src/sites/site-appearance.tsx:70-80`; `frontend/packages/ui/src/theme.ts:10-48` (Roboto, two themes) | 08 |
| P1-12 — missing expected university affordances | no sticky header, language switcher, CTA slot, breadcrumbs on interior pages, back-to-top or legal row in the reviewed chrome | 08 |
| Remaining audit | accessibility, responsive matrix, performance/CLS, non-home templates, SEO/metadata, i18n, error states, cross-browser | 09 |

### Review environment caveat

The development database was being mutated by QA runs during the review: the
Main homepage changed from “Main review mainqa-8995d437 homepage” to “QA shared
main homepage p4brand-0b2c8ca6”, and chrome menus and footer appeared mid-review.
This is itself a finding — see P4-F-CHROME-05 and P4-F-CHROME-09, which require a
seeded, read-only review environment before visual sign-off.

### Confirmed strengths to preserve

- Menu link safety: `safeMenuHref` rejects unsafe schemes, protocol tricks and
  encoded separators.
- Accessibility baseline: skip link, `main` landmark, 44 px targets,
  focus-visible rings, `aria-expanded`/`aria-controls`, Escape and arrow-key
  handling, `aria-current`, `prefers-reduced-motion`.
- Menus: multi-location, central/inherited ownership, draft → publish workflow,
  footer columns, mega-menu grouping, mobile drawer.
- Footer: typed settings, server validation, ETag concurrency, social allowlist,
  newsletter/support links, address/email/phone, live preview.
- Builder: 43-widget catalogue, undo/redo, desktop/tablet/mobile preview,
  responsive overrides, section templates, validation error mapping,
  draft/publish workflow.
- Architecture: host-resolved Site context, module gating, no cross-Site menu
  leakage.

Any implementation must keep these behaviours rather than replacing them.

## How to use this folder

1. Create the `P4-F-CHROME` feature in Azure DevOps.
2. Create one story per file and paste the file body as the issue description.
3. Set the parent link to `P4-F-CHROME` and record the real work-item ID.
4. Attach the PR, test results, screenshots and browser evidence listed in each
   story's **Required tests / evidence** section.
5. Update the story index table above with the real IDs.

## Definition of Done (feature level)

All child stories accepted; the Main Site and at least two child Sites verified
end to end; accessibility and responsive evidence attached; no unresolved
critical or high defects; feature-level acceptance recorded against the
`P4-F-CHROME` work item.
