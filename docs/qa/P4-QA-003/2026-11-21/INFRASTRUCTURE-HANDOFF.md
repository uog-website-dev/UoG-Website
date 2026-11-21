# Infrastructure-owned readiness evidence request

Status: **PENDING ? supplied and reviewed evidence is required before Go.** No infrastructure approval has been inferred from Docker health or CMS revision restoration. This packet does not take over infrastructure ownership or execute a production backup/rollback.

| Responsible team | Requested evidence | Acceptance/review needed |
| --- | --- | --- |
| Infrastructure / database operations | Timestamped PostgreSQL backup restored into an isolated environment, source image/schema versions, integrity checks, RPO/RTO and outcome | Demonstrate Main and pilot Site ownership, revisions, publication snapshots and canonical IAM survive; identify reviewer and approval reference |
| Infrastructure / object storage | Private MinIO backup/version recovery and restore linked to the database recovery point | Originals/derivatives/references resolve without public bucket exposure, missing-object exceptions documented |
| Identity operations | Keycloak database/realm/client configuration recovery, server-side secret rotation/storage, login and revocation checks | No expired/revoked privilege resurrection; no secrets in QA attachments |
| Release engineering | Image digests, migration rehearsal/rollback compatibility and actual deployment rollback transcript | Previous release restores safely without losing later valid content or exposing drafts; no destructive schema rollback assumption |
| Operations / observability | Redacted correlated logs, dashboards/alerts, retention/access policy and health/readiness checks | No tokens/passwords/private storage credentials; actionable upload/worker/auth/publication failures and named incident owner |
| Product / QA / infrastructure | Signed recovery/runbook review with open risks and mitigations | Evidence linked to the exact release candidate and accepted recovery objectives |

Supply artifact locations, hashes, environment, date, responsible owner and reviewer. Existing Main homepage revision restore is **content workflow evidence**, not PostgreSQL/MinIO disaster recovery or deployment rollback evidence. Healthy development services also do not establish production readiness.

No message was sent to an unspecified team or recipient. This document is the handoff request for the responsible owners to complete and attach to the release Issue.
