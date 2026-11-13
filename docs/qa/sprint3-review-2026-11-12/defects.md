# Sprint 3 defect disposition

These local IDs link to exact evidence. External tracker IDs remain pending.
No waiver, issue closure or stakeholder signature was fabricated.

## S3-RUNTIME-001 — OPEN, release blocker

Expected configured Contact Form validation, taxonomy-filtered Loop Grid,
Site identity bindings and switching Post context to work in public output.
Actual `contact_form`, `loop_grid`, `taxonomy_filter`, `site_logo`, `site_title`,
`post_title`, `post_excerpt` and `featured_image` all render the integration
fallback. No provider or identity binding was substituted.

Evidence: [actual 43-widget output matrix](release-audit/runtime-matrix.json),
[renderer instrumentation](release-audit/renderer-capability.log),
[shared renderer](../../../frontend/packages/ui/src/visual-layout.tsx).
Disposition: implement/configure the providers and context bindings, then verify
visitor validation, filtering, Site isolation and Post switching in a real browser.
Passing a schema fixture does not close this defect.

## S3-CHECK-004 — OPEN, build blocker

Expected TypeScript and optimized admin-web build to pass. Actual:

- `visual-builder-inspector.tsx:72`: `next.alt` is assigned to an object inferred
  as `{asset_id:string}` (TS2339).
- `visual-builder-inspector.test.tsx:119`: `{}` is supplied where `newWidget`
  requires an asset identifier and alt text (TS2345).

Evidence: [TypeScript](release-audit/typescript.log),
[admin build](release-audit/build-admin-web.log).
The [public-web build](release-audit/build-public-web.log) passes.
Disposition: correct typing/fixture inputs, then repeat type checking and the
isolated production build. This review did not modify those files.

## S3-SCHEMA-005 — OPEN, CI baseline blocker

Spectacular validation and 14 documentation tests pass, but generated OpenAPI
differs at `/api/v1/sites/{site_pk}/pages/{id}/visual-draft/`. A parsed-YAML
comparison confirms a semantic difference, not just line endings. Component
schemas are unchanged.

Evidence: [difference](release-audit/schema-difference.json),
[generated contract](release-audit/sprint3-schema.yaml),
[validation log](release-audit/openapi.log),
[existing pipeline comparison](../../../azure-pipelines.yml).
Disposition: review the visual-draft module/documentation policy, regenerate the
approved baseline and obtain a passing hosted CI run for the reviewed source.

## S3-SOURCE-006 — OPEN, evidence integrity gate

Five frontend files changed between the recorded source hashes: Builder chooser
route, Page Builder route, Site admin frame, section registry and Site dashboard.
Backend observations are retained, but the combined run cannot certify a single
immutable release build. Concurrent changes were not overwritten.

Evidence: [start](release-audit/source.json), [end](release-audit/source-after.json),
[drift](release-audit/source-drift.json).
Disposition: freeze the final source and repeat into a fresh output directory.

## S3-E2E-002 — NOT VERIFIED, release gate

Real authenticated HTTP/storage/worker/routing checks passed. A real browser
was not driven through OAuth, the picker, dashboard, canvas and configured
providers. Returning a Next.js shell is insufficient. Complete and retain the
seeded-user browser walkthrough; Vite fixtures and forced authentication do not
satisfy this gate.

## S3-SIGNOFF-003 — PENDING, approval gate

QA Lead, Technical Lead and Product Owner approvals are not supplied. The
[template](release-audit/signoff.json) remains unsigned. Hosted CI evidence must
identify the reviewed source. Preserve actual signed records separately from
generated templates and bind them to the final source/evidence manifest.

## S3-EVIDENCE-000 — FIXED, evidence classification defect

The prior report counted mocked storage/in-process processing as real-stack
acceptance, called local validation a hosted CI result, and waived browser E2E
without approval. It is archived and superseded. The compatibility command now
invokes a fail-closed audit, separates a real live run and exits NO-GO while
release gates remain open. Hash manifests are not reviewer signatures and no
longer contain their own prior contents.

The first live attempt also deleted a Medicine test asset before comparing its
generation. That was a fixture error, not cross-Site invalidation. The failed
attempt is retained under [live-release/attempts](live-release/attempts/).
The corrected fixture completes peer setup before its baseline and performs
subsequent deletion checks in Informatics.

Historical P2 defect records still require owner review. No disposition or
waiver was granted for them by this automated run.
