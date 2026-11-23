# P4-F-CHROME-01 — One visible H1 and correct heading semantics

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source finding: P0-1. Severity: P0.

## User story

As a Site Author or Editor, I want each visual page to expose exactly one visible
main heading, so that readers, assistive technology and search engines can
identify the page correctly.

## Business context

This capability is part of P4-F-CHROME and fixes a structural defect in the
Visual Builder. Today every page with a visual layout hides its page title,
while hero headings default to `h2`. The rendered Main homepage therefore has no
visible `h1`: the only `h1` is the clipped page title.

Business outcome: accessible, SEO-correct pages without authors needing to
understand heading semantics.

## Implementation requirements

- Remove the unconditional `hideTitle` behaviour for visual pages in
  `frontend/apps/public-web/src/app/page.tsx` (currently
  `hideTitle={Boolean(visible?.visual_layout)}`).
- Make `settings.show_title` the single source of truth for title visibility and
  default it to visible.
- Keep the hero `heading_level` default at `h2` unless the page title is hidden
  and the hero is the only visible `h1`.
- Add builder validation that blocks save and publish when a page would have
  zero or more than one visible `h1`, with a field-level message on the page
  settings control.
- Keep the clipped page title as a screen-reader fallback only when no visible
  `h1` exists for a legitimate reason.
- Do not introduce a schema migration unless an inventory proves one is
  required; preserve existing layouts.
- Update the builder label so it reflects what the public page will render.

## Acceptance criteria

- AC-01: A newly published visual page renders exactly one visible `h1`.
- AC-02: Selecting “Hide title visually” requires another widget to be the `h1`;
  otherwise the builder blocks save with a field-level message.
- AC-03: The builder preview matches public rendering for visible and hidden
  titles.
- AC-04: Existing published pages keep rendering; a page with no visible `h1`
  receives the safe default rather than staying broken.
- AC-05: Non-visual pages and Post pages are unchanged.
- AC-06: The hidden-title fallback remains available to screen readers when it is
  legitimately required.
- AC-07: Heading order below the `h1` remains sequential with no skipped levels
  introduced by the fix.

## Required tests / evidence

- Unit tests for title and heading resolution, including default, explicit
  visible, explicit hidden and hero-as-`h1` combinations.
- Component tests for builder validation, field-level errors and preview
  fidelity.
- Real-browser E2E on the Main Site and at least two child Sites at desktop and
  mobile widths, asserting exactly one visible `h1`.
- Regression screenshots before and after, attached to the Issue.

## Dependencies / prerequisites

- PAGES and VISUAL_BUILDER modules enabled for the target Sites.
- Existing visual layout schema (`show_title`, hero `heading_level`).

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
