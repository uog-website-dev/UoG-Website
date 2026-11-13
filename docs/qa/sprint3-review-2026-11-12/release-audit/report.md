# Sprint 3 release audit

**Decision: NO-GO for Sprint acceptance. Sign-off remains unsigned.**

Reviewed HEAD: `ed82e429a801bc8fd2dc616698c2f948cc4b792c`; working tree dirty: `True`.
Source snapshot: `f58556302a602ffb78897fd4e35cc1a4e851f1084f3303853f8b8d3348a67734`; stable throughout run: `False`.

## Repeatable evidence

| Run | Tests | Failures | Errors | Skips |
| --- | ---: | ---: | ---: | ---: |
| [sprint3-openapi.xml](sprint3-openapi.xml) | 14 | 0 | 0 | 0 |
| [sprint3-protocol.xml](sprint3-protocol.xml) | 162 | 0 | 0 | 0 |
| [sprint3-renderer.xml](sprint3-renderer.xml) | 73 | 0 | 0 | 0 |

Live services: **PASS**. [Actual inputs/outcomes and retained Site/profile IDs](live-services.json).
This uses real Keycloak JWTs, HTTP through nginx/Django, PostgreSQL, private MinIO and non-eager Celery workers. Next.js is probed as an HTTP shell; browser hydration is not asserted.

## Acceptance blockers

- **S3-RUNTIME-001**: Required widgets do not have functional public provider/context rendering
- **S3-E2E-002**: Real browser OAuth, picker/dashboard hydration and provider interactions have no end-to-end evidence
- **S3-SIGNOFF-003**: Named reviewer signatures and an actual hosted OpenAPI CI run are not supplied
- **S3-CHECK-004**: One or more recorded commands failed
- **S3-SCHEMA-005**: Generated OpenAPI differs from the checked-in baseline or is missing
- **S3-SOURCE-006**: Source changed during the run; repeat against one frozen source snapshot

Required runtime output failures: contact_form, site_logo, site_title, loop_grid, taxonomy_filter, post_title, post_excerpt, featured_image.
A valid 43-widget schema is not proof of Contact Form visitor validation, taxonomy-filtered data, Site identity binding or Post-context switching. The actual shared renderer was probed without fake provider bindings.

The pytest integration uses authentication/storage/processing doubles for deterministic protocol checks and is labelled separately from the real live run. Provider transfer-interruption tests are fault-injection tests, not proof that a live provider outage was exercised.

No open release gate is automatically waived. Existing P2 defect dispositions require separate owner review; this run does not close or reclassify them.

[Source/build environment](environment.json) · [commands](commands.json) · [runtime matrix](runtime-matrix.json) · [checklist](checklist.json) · [defects](defects.json) · [unsigned sign-off](signoff.json)

Local OpenAPI checks follow the pipeline validation commands; an actual hosted CI run/link has not been supplied. [OpenAPI snapshot](sprint3-schema.yaml).

The prototype walkthrough is [separate](prototype-walkthrough/README.md). Review-created identities are disabled; retained Sites, CMS revisions and audit rows belong to this review run and are not production homepage assignments.
