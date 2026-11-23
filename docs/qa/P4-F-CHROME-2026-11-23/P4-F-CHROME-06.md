# P4-F-CHROME-06 — Mobile header and footer compaction

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source findings: P1-6, P1-7. Severity: P1.

## User story

As a mobile visitor, I want a compact header and a scannable footer, so that I
can reach content without scrolling past chrome.

## Business context

This capability is part of P4-F-CHROME. At 390×844 the header measured 170 px
and the footer 1 573 px — almost two full screens before content. The footer
stacks every group on `xs`, the utility navigation stays horizontal, and the
active navigation indicator floats mid-header because triggers use a 60 px
minimum height inside a 104 px header.

Business outcome: faster access to content and a professional mobile experience.

## Implementation requirements

- Collapse utility links into the mobile drawer instead of keeping a separate
  horizontal utility row.
- Reduce the mobile header to one compact row, targeting 64–80 px.
- Convert footer columns to accordions below `md`, with `aria-expanded`,
  `aria-controls` and keyboard support.
- Use a two-column footer grid at `sm` and the configured columns from `md` up.
- Cap visible links with a “More” disclosure where a group is long.
- Anchor the active navigation indicator to the header baseline, or underline
  the label only.
- Respect safe-area insets, reduced motion and 44 px touch targets.

## Acceptance criteria

- AC-01: Header height is at most 96 px at 390 px, targeting 72 px.
- AC-02: Footer columns are collapsed by default and expandable by keyboard and
  touch.
- AC-03: No horizontal scrolling from 320 px to 430 px.
- AC-04: All interactive targets meet 44 px and show visible focus.
- AC-05: Desktop header and footer composition is unchanged.
- AC-06: Reduced-motion preference removes non-essential animation.
- AC-07: The active navigation indicator aligns with the header baseline.
- AC-08: Screen readers announce accordion state changes.

## Required tests / evidence

- Component tests for drawer and accordion behaviour, including keyboard.
- E2E at 320, 360, 390 and 430 px.
- Accessibility checks and visual regression screenshots.
- Before and after measurements attached to the Issue.

## Dependencies / prerequisites

- Existing header, navigation and footer components.
- P4-F-CHROME-03 where header composition becomes configurable.

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
