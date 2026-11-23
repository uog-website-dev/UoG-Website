# P4-F-CHROME-02 — Safe page width, gutters and explicit bleed

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source finding: P0-2. Severity: P0.

## User story

As a Site Author, I want pages to keep readable margins by default and to go
edge-to-edge only when I explicitly choose it, so that content never touches the
viewport edge.

## Business context

This capability is part of P4-F-CHROME and addresses a layout gap in the Visual
Builder. “Full width” is the current default and removes all container padding,
so text rows can render flush to the viewport edge. Measured at 1440 px, the
page container, article and first row all started at `x=0` with width `1440` and
padding `0`.

Business outcome: predictable, professional layouts on every screen size.

## Implementation requirements

- Default `content_width` to “Wide · 1280px”.
- Preserve a minimum 24 px safe gutter at every breakpoint.
- Add an explicit page-level bleed setting, decoupled from content width, and
  derive `data-page-bleed` from that setting only.
- Update the public container so only an explicit bleed removes padding.
- Provide a migration path for existing full-width pages: convert to Wide, or
  record an explicit opt-in to bleed.
- Keep “Reading · 880px” and “Wide · 1280px” behaviour unchanged.
- Keep the builder preview and public output driven by the same width resolver.

## Acceptance criteria

- AC-01: A new visual page defaults to Wide with visible gutters.
- AC-02: No text or media touches the viewport edge unless bleed is enabled.
- AC-03: Bleed is opt-in, labelled clearly in the builder, and shows a warning.
- AC-04: Existing pages render without unintended visual regression.
- AC-05: Builder preview and public output agree at 320, 390, 768, 1024 and
  1440 px.
- AC-06: Invalid or unknown width values fall back to the safe default.
- AC-07: A page converted to Wide retains its widget content and ordering.

## Required tests / evidence

- Unit tests for width and gutter resolution, including invalid input.
- Component tests for the page settings controls and bleed warning.
- E2E and visual regression across the responsive matrix above.
- Migration evidence for existing full-width pages.
- Before and after screenshots attached to the Issue.

## Dependencies / prerequisites

- PAGES and VISUAL_BUILDER modules.
- Existing visual layout schema (`content_width`).

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
