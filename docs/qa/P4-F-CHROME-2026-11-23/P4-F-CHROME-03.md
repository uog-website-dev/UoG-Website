# P4-F-CHROME-03 — Header settings with live preview

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source finding: P0-3. Severity: P0.

## User story

As a Site Administrator, I want one Header screen where I can configure
branding, utility links, navigation, search and a call to action, so that I can
manage the public header without developer assistance.

## Business context

This capability is part of P4-F-CHROME and closes a concrete ownership gap: the
footer is configurable, but the header is hard-coded in
`frontend/apps/public-web/src/public-menus.tsx`. Site administration defines
Dashboard, Pages, Sidebars, Visual Builder, Homepage, Footer, Appearance, Posts,
Media, Users and Menus — there is no Header section, and Appearance exposes only
title, logo and one of two themes.

Business outcome: consistent, professional headers for the Main Site and every
eligible child Site, managed by the Site team rather than by a developer.

## Implementation requirements

- Add a Header section to Site administration, or a “Site chrome” screen with
  Header and Footer tabs.
- Support: logo and display-name link target, utility menu assignment, header
  menu assignment, search visibility, sticky behaviour, call-to-action label and
  safe URL, and language-switcher visibility.
- Reuse the existing menu locations (`header`, `secondary`) and the existing menu
  draft/publish workflow rather than creating a parallel menu store.
- Provide a live preview using the real public header component.
- Enforce `sites.update` permission, Site scoping and the MENUS/PAGES module
  gates on read and write.
- Do not accept raw HTML, CSS or JavaScript.
- Persist settings through a typed server contract with field-level validation
  errors and optimistic concurrency.

## Acceptance criteria

- AC-01: An authorized administrator can open Header for their Site.
- AC-02: Changes appear in preview and become public only after the defined
  save/publish action.
- AC-03: Header and utility menus respect the existing menu draft/publish state.
- AC-04: Search is hidden when neither PAGES nor POSTS is enabled.
- AC-05: The call to action rejects unsafe URLs and requires a label when a URL
  is present.
- AC-06: A user without `sites.update` receives a denied response, including
  when calling the API directly.
- AC-07: A user assigned only to Site A cannot read or modify Site B’s header
  settings by changing identifiers.
- AC-08: A mobile preview is available and matches public rendering.
- AC-09: Invalid values return field-level validation and do not persist.

## Required tests / evidence

- Backend validation, authorization, Site isolation and module-toggle tests.
- Frontend component tests and real-browser E2E of the configuration flow.
- OpenAPI/Swagger and configuration guidance updates.
- Preview-versus-public screenshots attached to the Issue.

## Dependencies / prerequisites

- MENUS and PAGES modules; Site RBAC; existing menu locations
  (`header`, `secondary`).
- P4-F-CHROME-05 for publish governance, where the two stories share a gate.

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
