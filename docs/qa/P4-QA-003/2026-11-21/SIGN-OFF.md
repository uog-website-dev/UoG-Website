# Product Owner / QA / Security release decision

Automated evidence disposition: **NO-GO ? deployment blocked.**

This is not a signed Product Owner decision. Product Owner, QA, Security and infrastructure review records are **PENDING**. The answer ?QA? identifies a review/environment label; it is not a named, timestamped approval.

| Role | Named reviewer | Decision | Date/time | External approval/audit reference | Reviewed evidence SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Product Owner | PENDING | PENDING | PENDING | PENDING | PENDING |
| QA Lead | PENDING | PENDING | PENDING | PENDING | PENDING |
| Security Lead | PENDING | PENDING | PENDING | PENDING | PENDING |
| Infrastructure owner | PENDING | PENDING | PENDING | PENDING | PENDING |

Review the defect register, story/PR review inventory, current regression failures, WCAG results/manual exceptions, 500-user performance evidence and infrastructure handoff. Record accepted **nonblocking** risks explicitly. Unresolved critical/high defects cannot be made acceptable by changing their status to ?accepted risk.? A signed No-Go must continue to block deployment and must not label the release production-ready.

Each external approval must bind the canonical manifest digest (`reviewed_manifest_sha256`). The digest excludes only that digest field and the signature records; changing any fact or artifact hash invalidates existing approvals. Approval identities and references must be verified in the organization?s authoritative review system; filling a JSON field is not identity verification. Never generate human names, dates or approval references automatically.

Issue/PR attachment and actual human approval remain outstanding. After remediation, collect a clean regression run and immutable-candidate evidence, regenerate the manifest/digest and obtain fresh approvals. Run `python scripts/qa-release-gate.py --manifest <manifest.json> --output <decision.json>`; exit 1 is the expected blocked release result, not permission to override the gate.
