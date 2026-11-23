# P4-F-CHROME-07 — Server-delivered navigation and CLS protection

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source finding: P1-8. Severity: P1.

## User story

As a visitor, I want navigation to be available immediately, so that the header
does not jump after the page loads.

## Business context

This capability is part of P4-F-CHROME. Menus are fetched after hydration, so the
initial server response renders branding and search only and the navigation pops
in afterwards. That produces a visible layout shift and delays the primary
navigation path.

Business outcome: stable layout and faster perceived performance on every Site.

## Implementation requirements

- Resolve menus during server rendering, or reserve skeleton space for the
  navigation so the header does not move.
- Cache the host-scoped menu response safely, keyed by Site.
- Keep host isolation: never reuse another Site’s menu.
- Fail closed when MENUS is disabled or the response is a 404.
- Preserve keyboard order, focus behaviour and active-state logic before and
  after hydration.
- Keep the existing safe link handling and menu inheritance rules unchanged.

## Acceptance criteria

- AC-01: Navigation is present in the initial HTML, or its space is reserved so
  no shift occurs.
- AC-02: Cumulative Layout Shift attributable to the header is below 0.1.
- AC-03: A missing menu response renders no navigation and no error state.
- AC-04: A request for Site A never returns Site B’s menu.
- AC-05: MENUS disabled hides navigation and blocks writes.
- AC-06: Focus order is stable before and after hydration.
- AC-07: Cached content is invalidated when the menu is published.

## Required tests / evidence

- Server-rendering/RSC tests for the menu payload.
- Performance evidence for CLS and header timing.
- Site isolation and module-toggle tests.
- E2E on the Main Site and a child Site, with and without a published menu.

## Dependencies / prerequisites

- MENUS module; public-web layout; the menu publish workflow.
- A safe caching layer compatible with host-based Site resolution.

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
