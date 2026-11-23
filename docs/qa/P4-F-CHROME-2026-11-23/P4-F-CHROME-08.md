# P4-F-CHROME-08 — Professional appearance and university affordances

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source findings: P1-11, P1-12. Severity: P1.

## User story

As a Site Administrator, I want approved header variants, typography and the
standard university affordances, so that the Site looks institutional rather than
templated.

## Business context

This capability is part of P4-F-CHROME. Appearance currently exposes only title,
logo and one of two themes, and the shared theme uses a Roboto/system stack. The
reviewed chrome had no sticky header, language switcher, call to action,
breadcrumbs on interior pages, back-to-top or legal/accessibility links.

Business outcome: a credible, full-featured university presence for the Main Site
and every child Site, delivered through approved options rather than custom code.

## Implementation requirements

- Add a brand type scale and an approved font stack to the shared theme.
- Offer two or three approved header variants (for example standard, centred,
  compact) that compose with the Header settings from P4-F-CHROME-03.
- Add sticky-header behaviour as a Site setting.
- Add language-switcher visibility when more than one language is enabled, using
  the existing language configuration.
- Add a configurable call-to-action slot in the header.
- Add breadcrumbs on non-home pages.
- Add back-to-top and a legal/accessibility links row in the footer.
- Keep the no-custom-CSS/JavaScript policy and the existing contrast baseline.

## Acceptance criteria

- AC-01: Header variants are previewable and selectable per Site.
- AC-02: Both themes meet WCAG 2.2 AA contrast for text, controls and focus
  indicators.
- AC-03: The language switcher appears only when more than one language is
  enabled, and is absent otherwise.
- AC-04: Breadcrumbs appear on non-home pages and are absent on the homepage.
- AC-05: Legal and accessibility links are configurable, validated and open
  safely.
- AC-06: Sticky behaviour can be disabled and respects reduced-motion and
  keyboard focus.
- AC-07: All new affordances are keyboard reachable and have accessible names.
- AC-08: Existing Sites render unchanged until they opt into a new variant.

## Required tests / evidence

- Theme contrast tests for both palettes, including focus states.
- Component and E2E tests for each affordance.
- i18n checks for the language switcher and breadcrumbs.
- Accessibility checks and visual regression evidence attached to the Issue.

## Dependencies / prerequisites

- P4-F-CHROME-03 (Header settings), existing i18n configuration and themes.
- Agreed brand assets and approved typography.

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
