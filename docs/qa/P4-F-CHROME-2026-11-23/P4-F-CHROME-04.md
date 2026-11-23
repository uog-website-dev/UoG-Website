# P4-F-CHROME-04 — Separate site chrome from page canvas

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source finding: P0-4. Severity: P0.

## User story

As a Site Author, I want the builder to stop offering site-logo, site-title and
menu widgets inside normal page content, so that pages do not repeat branding or
headings.

## Business context

This capability is part of P4-F-CHROME and addresses a duplication defect
observed on the Main and CAES fixtures. The public shell always renders header
and footer, `PublicPageView` also renders a compact branding lockup inside the
article, and the builder palette exposes `site_logo`, `site_title`, `menu` and
`breadcrumbs` in the “Site & navigation” category. The brand appeared three
times and the page exposed two `h1` elements.

Business outcome: one header, one brand and one `h1` per page.

## Implementation requirements

- Remove `site_logo`, `site_title` and `menu` from the default page palette, or
  gate them behind an explicit “page without global chrome” mode.
- Remove the automatic in-article branding lockup, or make it an explicit,
  documented opt-in.
- Add a page-level “hide global header/footer” setting with a clear warning and
  a faithful preview.
- Detect existing layouts that already contain chrome widgets and show a
  migration notice rather than silently changing them.
- Keep breadcrumbs available as a content widget where they are appropriate.
- Keep homepage templates free of chrome widgets.
- Preserve existing published pages during migration.

## Acceptance criteria

- AC-01: New pages cannot add chrome widgets through the default palette.
- AC-02: Existing pages containing chrome widgets still render, with a visible
  migration warning in the builder.
- AC-03: Hiding global chrome is explicit, previewed and cannot be enabled
  accidentally.
- AC-04: The default authoring path produces no duplicate branding and exactly
  one visible `h1`.
- AC-05: Homepage templates no longer include chrome widgets.
- AC-06: No published page breaks or loses content during migration.
- AC-07: A page using the explicit chrome-free mode renders without header and
  footer but retains its own navigation affordance.

## Required tests / evidence

- Builder model and palette tests, including legacy layout compatibility.
- Renderer compatibility tests and migration evidence.
- E2E on the Main Site and at least two child Sites.
- Visual regression before and after, attached to the Issue.

## Dependencies / prerequisites

- VISUAL_BUILDER module; existing homepage templates; agreed content migration
  plan.
- P4-F-CHROME-01, since chrome-free mode changes which element supplies the
  `h1`.

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
