# P4-F-CHROME-09 — Complete the remaining chrome audit

Parent: **P4-F-CHROME**. Proposed ID, not an existing Azure DevOps work-item ID.
Source: remaining audit. Severity: P1/P2.

## User story

As a Product Owner, I want a complete audit of the remaining public and admin
surfaces, so that the next increment is planned from evidence rather than
assumptions.

## Business context

This capability is part of P4-F-CHROME. The current review covered the rendered
homepages, the public header, menus, footer and search, the Visual Builder page
settings, the footer and appearance admin screens, and the empty-homepage
fallback. It did not cover the remaining templates, the full accessibility
matrix, performance under load, or cross-browser behaviour.

Business outcome: a prioritised, evidence-backed backlog for accessibility,
responsiveness, performance and content governance.

## Implementation requirements

- Audit WCAG 2.2 AA: heading order, landmarks, focus traps in the drawer and
  dialogs, contrast in both themes, 400 % zoom and reflow, and screen-reader
  announcements.
- Audit the responsive matrix at 320, 360, 390, 768, 1024, 1280, 1440 and
  1920 px, including tablet navigation and long or localised labels.
- Audit performance: CLS, LCP, lazy images, font loading and builder interaction
  latency.
- Audit non-home templates: Page, Post list, Post detail, category archive,
  search results, 404, contact and sidebar layouts.
- Audit SEO and metadata: per-page title and description, Open Graph, canonical,
  sitemap, robots, structured data, hreflang and favicon.
- Audit i18n: public language switching, menu and page locale behaviour, and
  fallback rules.
- Audit error, empty and loading states: module disabled, menus 404, homepage
  404, offline and API failure.
- Use a seeded, read-only review environment so QA fixtures cannot change during
  the audit.
- Produce severity, reproduction steps and evidence for every finding. Do not
  change product code in this story.

## Acceptance criteria

- AC-01: Every audited surface has a severity, evidence and a reproduction path.
- AC-02: Findings are mapped to an existing or new P4-F-CHROME story.
- AC-03: The review environment is reproducible and isolated from QA writes.
- AC-04: No product code is modified by the audit.
- AC-05: Evidence is attached to the Azure DevOps Issue.
- AC-06: The resulting backlog is reviewed and prioritised with the Product
  Owner.

## Required tests / evidence

- axe or equivalent automated accessibility results for each audited template.
- Manual keyboard and screen-reader notes.
- Lighthouse or equivalent performance evidence.
- Browser and device matrix results.
- Screenshots and DOM notes for each finding.

## Dependencies / prerequisites

- A seeded, read-only review environment; access to the Main Site and at least
  three child Sites; POSTS, PAGES, MENUS and VISUAL_BUILDER enabled where
  required.

## Definition of Done

Audit report reviewed and approved; every finding has evidence and a severity;
backlog items linked; no unresolved critical or high audit gaps; report attached
to the Azure DevOps Issue.
