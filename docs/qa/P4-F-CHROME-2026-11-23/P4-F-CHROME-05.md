# P4-F-CHROME-05 — Public labels and publish gate for chrome

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source findings: P0-5, P1-9. Severity: P0.

## User story

As a Site Editor, I want footer headings and chrome changes to be previewed and
approved before they go public, so that internal menu names and QA text never
reach visitors.

## Business context

This capability is part of P4-F-CHROME. Footer column headings are currently
taken from the internal menu name, and footer settings save immediately, unlike
menus which have a draft/publish workflow. During the review the public footer
displayed headings such as “University Main - Footer” and “Main review
mainqa-8995d437 University resources”, and child-Site image alt text contained
“used as a private design reference”.

Business outcome: public-facing chrome copy is intentional, reviewed and
recoverable.

## Implementation requirements

- Add a public heading field per footer column, separate from the internal menu
  name, and use it for rendering.
- Support an optional column description and explicit display order.
- Introduce draft and publish states for footer and header settings with ETag
  conflict handling.
- Add a pre-publish content lint for placeholder text, “QA” markers, “reference”
  wording, duplicate `h1` and missing alt text; block or warn according to an
  agreed policy.
- Keep an audit trail and a recoverable previous published state.
- Preserve existing footer settings during migration, seeding the public heading
  from the current menu name where no explicit label exists.
- Keep the existing server validation, social allowlist and HTTPS-only rules.

## Acceptance criteria

- AC-01: Renaming an internal menu does not change the public footer heading.
- AC-02: Footer and header changes remain private until published.
- AC-03: Preview shows draft values, not the last published values.
- AC-04: The lint blocks or warns on placeholder, QA or reference content
  according to the agreed policy, with a clear message.
- AC-05: A stale ETag produces an explicit conflict instead of overwriting a
  newer save.
- AC-06: The previous published settings remain recoverable.
- AC-07: A user without the required permission receives a denied response,
  including on direct API calls.
- AC-08: A user assigned only to Site A cannot read or modify Site B’s chrome
  settings.

## Required tests / evidence

- Backend validation, ETag/publish, lint and audit tests.
- Frontend component tests and real-browser E2E of the draft → publish flow.
- Site isolation and module-toggle tests.
- Migration and rollback evidence; before and after footer screenshots.

## Dependencies / prerequisites

- MENUS module, footer model and API, Site RBAC.
- Agreed policy for lint severity (block versus warn).

## Definition of Done

Code reviewed and approved; implementation integrated end to end; applicable
migrations applied and rollback-checked; relevant backend, API, frontend and
browser tests automated and passing; OpenAPI/Swagger and user-facing
configuration guidance updated where applicable; Keycloak/RBAC, Site isolation
and module gates verified; accessibility and error paths checked; no unresolved
critical or high defects; linked PR and QA evidence attached to the Azure DevOps
Issue.
