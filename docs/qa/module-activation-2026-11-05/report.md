# Local Posts activation — 2026-11-05

The reported errors had two separate causes: `devuser` already had
`platform.sites.manage_registry`, but development writes were disabled and the
implemented POSTS module was globally disabled.

Enabled `ORGANIZATIONS_DEV_WRITES_ENABLED=True` in the ignored local `.env` and
recreated only the backend service. Developer volumes and production defaults
were preserved. The existing `DEBUG` and application-permission checks remain.

Using the configured development identity through real Keycloak authentication:

1. Updated POSTS platform availability through authenticated PATCH with If-Match.
2. Previewed activation for only Site 2 (`INFORMATICS`).
3. Applied the preview with a UUID idempotency key and operation reason.
4. Replayed the exact request; the same committed operation was returned.
5. Verified the Site's POSTS assignment is enabled and effectively available.
6. Verified anonymous bulk apply still returns 401.

Operation: `ba560d07-d888-47bc-a6dd-ad702431be00`.
Redacted request status/correlation evidence is in `result.json` and policy
verification is in `security-check.json`. No passwords, live tokens or cookies
are recorded. No roles were granted, and no commit or push was performed.

Refresh the Modules page and generate a new preview after this configuration
change; an earlier preview describes the old globally-disabled state. Site-only
administrators still cannot use central platform operations.
