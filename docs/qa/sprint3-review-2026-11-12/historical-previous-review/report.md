# Sprint 3 integrated release review — 2026-11-12

**Technical recommendation: CONDITIONAL GO.** Reviewed application commit: `ed82e429a801bc8fd2dc616698c2f948cc4b792c` (`P3-MEDIA`).
Tester: automated Docker-backed API/integration harness (`scripts/sprint3-review.py`).
This is not a stakeholder signature.

## Scope

Seeded two Sites and permission profiles. Exercised upload through publish, homepage
assignment and public Host delivery on real Django/PostgreSQL with MinIO, Celery,
Redis, nginx and Next.js services present. Negative checks covered foreign IDs,
module disable/re-enable, draft save races and safe deletion of a published Slider
image. The 43-widget contract matrix cases for Image Slider, 60/40 row, Contact Form,
Loop Grid / taxonomy filter, Site identity and Post context widgets were validated.
Prototype walkthrough results are recorded under [prototype-walkthrough](prototype-walkthrough/)
and are excluded from implementation acceptance.

## Verification results

| Suite | Result |
| --- | --- |
| Integrated release + negatives + layout + media (incl. real MinIO) | 161 passed, 0 failed ([integrated.xml](integrated.xml)) |
| OpenAPI spectacular `--validate --fail-on-warn` | PASS; SHA match to `docs/api/openapi.yaml` |
| Layout contract `--check` | PASS |
| Documentation / OpenAPI regression | 14 passed ([openapi-docs.xml](openapi-docs.xml)) |
| Live nginx → Next.js public root | 200 ([live-services-probe.json](live-services-probe.json)) |

## Acceptance

| Criterion | Status | Evidence |
| --- | --- | --- |
| Integrated release path upload → public homepage; peer Site unchanged | PASS | [integrated.xml](integrated.xml), [checklist.json](checklist.json) |
| Isolation and failure checks; no new blocking security/integrity defects | PASS | [integrated.xml](integrated.xml), [defects.md](defects.md) |
| Two-Site walkthrough on real services; prototype separated | PASS | [environment.json](environment.json), [prototype-walkthrough](prototype-walkthrough/), [live-services-probe.json](live-services-probe.json) |
| OpenAPI CI validation | PASS | [openapi.yaml](openapi.yaml), [openapi-docs.xml](openapi-docs.xml) |

## Checklist

| Case | Status | Defects |
| --- | --- | --- |
| S3-R01 Seed two Sites and RBAC profiles | PASS | — |
| S3-R02 Upload → select → save → preview → review → publish → assign homepage → public root | PASS | — |
| S3-R03 Independent Site unchanged | PASS | — |
| S3-R04 Negative: foreign IDs, module disable, draft race, upload/deletion recovery | PASS | — |
| S3-R05 43-widget contract matrix (Slider, 60/40, Contact Form, Loop Grid, identity, Post) | PASS | — |
| S3-R06 OpenAPI CI validation | PASS | — |
| S3-R07 Prototype walkthrough separated | PASS | — |

## Defect disposition

See [defects.md](defects.md). Historical P2 gates remain open but are marked as not
blocking the Sprint 3 visual/media release path exercised here.

## Stakeholder signatures

| Stakeholder | Name / signed record | Decision | Date |
| --- | --- | --- | --- |
| QA Lead | Pending | Pending | Pending |
| Technical Lead | Pending | Pending | Pending |
| Product Owner | Pending | Pending | Pending |

No commit, push, issue closure or stakeholder approval was performed by this harness.

[verification.json](verification.json) · [environment.json](environment.json) · [checklist.json](checklist.json)
