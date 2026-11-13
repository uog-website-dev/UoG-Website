# P0-USER-002: canonical CMS authorization

CMS now uses live database-backed Site memberships as its only Site authorization source. `SiteContentRoleAssignment`, its HTTP management routes and its runtime fallback have been removed. The role-reconciliation archive is provenance only: neither authorization nor workflow controls read it to grant access.

| Site membership | CMS operations |
| --- | --- |
| Editor | Author |
| Reviewer | Review |
| Publisher | Publish/unpublish |
| Site Administrator | Author, review and publish within that Site |
| Viewer | Read-only |

The central gate checks active users and roles, Site scope, revocation and expiry on every operation. Authentication also preserves local account deactivation: a valid identity-provider token cannot reactivate a disabled local user. Workflow buttons derive their actions from that same gate. Platform-wide authority remains limited to a live database Platform Administrator assignment. Realm roles and Django staff/superuser flags do not substitute for assignments. Existing module gates, optimistic versions, immutable snapshots, self-review restrictions and publication validation remain in place.

## Staged deployment and review

For an existing deployment, apply **only** `cms.0021_legacy_role_reconciliation` first, using the migration DB role. Keep the previous application release available until reconciliation is complete. Use a maintenance window to stop legacy grant writes during the final report/application/cutover; the apply command also locks legacy grants and canonical assignment/role tables while processing decisions.

```sh
python manage.py migrate cms 0021_legacy_role_reconciliation
python manage.py reconcile_cms_roles --report inventory.json
```

The report includes source grant IDs, user/Site IDs, original timestamps, proposed roles, current effective capabilities, proposed additional capabilities and a fingerprint of the reviewed state. The fixed mappings are AUTHOR → Editor, REVIEWER → Reviewer and PUBLISHER → Publisher. Multiple approved roles remain separate Site memberships. The command never maps to Site Administrator or a broader scope.

Existing live canonical memberships that already cover a grant are recorded as COVERED without duplicating them. Inactive identities are RETIRED without creating latent memberships. Every other active legacy-only or unmapped grant is REVIEW_REQUIRED. Even a zero RBAC capability delta requires review because a full membership can cover CMS surfaces beyond the original workflow grant.

A Platform Administrator must explicitly approve any new mapping using the exact fingerprint. Example approval-file shape (use actual IDs/hashes from the current report):

```json
[
  {
    "legacy_id": 123,
    "fingerprint": "exact fingerprint from the reviewed inventory",
    "decision": "MAPPED",
    "reason": "Reviewed and approved the listed additional Site capabilities."
  }
]
```

`RETIRED` is also an explicit review decision for an active grant that should not survive. Missing/stale approvals remain unresolved; they do not create assignments. Inactive or missing target roles and ineligible Sites cannot be mapped. Apply using the reviewing actor's active database Platform Administrator ID:

```sh
python manage.py reconcile_cms_roles --apply --actor 42 --approvals approvals.json --report reconciliation.json
```

Safe COVERED/inactive decisions can be applied without an approvals file. The command records source snapshots, permission differences, target assignment IDs, reviewer, reason and timestamp in `LegacyCMSRoleReconciliation`, and writes secret-free authorization audit events. Re-running it never recreates a migrated membership that was subsequently revoked or expired.

Then apply `cms.0022_retire_legacy_content_roles` and deploy the canonical-only application. That migration verifies every remaining legacy row has a matching reconciled source snapshot before dropping the table. Unresolved or changed rows stop the migration. Clean databases have no legacy grants, so both migrations apply without manual decisions. The final OpenAPI baseline contains no content-role management routes; Site Users and `/api/v1/authorization/assignments/` are the supported grant/revoke path.

## Controlled rollback

Retain a database backup and the reviewed reports before deployment. Resolve rollback with an operator rather than restoring old grants blindly. Reverse only `0022` to return to the immediately preceding bridge-compatible release; do not roll back canonical memberships or their revocation/expiry history.

The reverse migration recreates the legacy schema but restores only reconciled non-retired source grants whose corresponding canonical Site role is still live and whose user is active. It preserves original IDs/timestamps and resets the sequence. Retired grants and subsequently revoked/expired grants are not resurrected. Existing canonical memberships and reconciliation provenance remain. Reapplying `0022` verifies the same restored snapshots and does not duplicate memberships. Removing the provenance migration after cutover requires a separate retention decision and backup.

## Local rehearsal

The inventory found 73 grants, all attached to inactive QA identities. All were archived as RETIRED; zero new memberships or privileged grants were created. The legacy table is absent, and the unresolved inventory is empty. Real-browser checks exercised Editor, Reviewer and Publisher controls, foreign-Site denial and revocation within the same signed-in session. See [QA evidence](qa/P0-USER-002/README.md).
