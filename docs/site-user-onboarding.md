# Create and assign Site users

In **Site Administration → Users**, select **Create user**. Enter a unique username, email, password and confirmation, select a Site role, and optionally choose a profile picture. Success returns to the directory with the new membership and picture. **Add existing user** remains the way to grant access to an account that already exists. A username/email conflict should be resolved through that flow rather than by making a second identity.

Site Administrators can assign Site Administrator, Editor, Publisher, Reviewer or Viewer within the Site where they hold `platform.users.assign_roles`. Neither this form nor its API can create a platform-wide or organization-wide assignment. The Main Site and child Sites use the same service. Directory reads require `platform.users.view`; direct requests are checked independently of the UI. There is no separate Users module gate.

Usernames are normalized to lowercase and accept 3–150 ASCII letters/numbers and `._@+-`, starting with a letter/number. Email is required, validated and normalized to lowercase. Duplicate usernames/emails are checked case-insensitively locally and by Keycloak. Bootstrap and service-account usernames are reserved. Passwords must satisfy the existing Django validators and the configured Keycloak realm policy. Passwords are sent only to the backend/identity provider and are never stored as local usable passwords or written to audit evidence.

Site membership also supplies CMS access directly: Editor can author, Reviewer can review, Publisher can publish, Site Administrator can perform those Site operations, and Viewer can read. These checks use the current membership on each request; the legacy CMS grant table and management endpoints have been retired. Revoked/expired memberships and inactive roles stop authorizing CMS access. Existing module and workflow restrictions still apply. See the [CMS membership regression](qa/cms-site-membership-2026-11-13/README.md).

New accounts follow the realm's normal login rules. In the verified development realm, first login asks for first and last names. Email verification, required actions and stricter password rules remain controlled by Keycloak; onboarding does not mark email verified or skip those steps.

## Profile pictures

The optional picture accepts a single-frame PNG, JPEG or WebP up to 2 MiB and 4 million pixels. Validation detects the format from bytes, bounds decoding and rejects SVG, documents, corrupt files and animations. The backend strips source metadata and re-encodes a 128×128 JPEG. Only this bounded normalized image is stored, in a private `AccountProfile` row attached to the shared identity. This is an identity avatar, not a Site MediaAsset or a public media placement. It can appear in directories where that identity has Site membership without copying a storage object or requiring the Site's MEDIA module.

Authenticated directory responses contain a derived JPEG data URI or an empty string. No public profile image endpoint, MinIO key, original file, storage credential or external image URL is introduced. Missing pictures use the standard avatar fallback.

## API and provisioning lifecycle

`POST /api/v1/authorization/assignments/site-create-user/` accepts JSON fields `site`, `role`, `username`, `email`, `password`, `password_confirmation` and optional `profile_picture` (raw base64 bytes, without a data-URL prefix). Unknown fields, privileged flags, arbitrary role names and non-membership role IDs are rejected. The owning organization is resolved from the selected Site, never supplied by the caller. The response is the existing assignment shape with HTTP 201. Responses are private/no-store.

HTTP 400 reports field validation/duplicates, 401 rejects unauthenticated callers, 403 rejects unauthorized/foreign-Site operations, and 503 indicates provider or provisioning failure. A connection failure after submission may have an ambiguous result; refresh the directory before retrying. The backend never claims success before both identity and membership are ready.

The server creates the Keycloak identity disabled, commits an unusable-password local user, stable issuer/subject link, PENDING profile and one Site assignment, then enables the provider identity. A final transaction checks current delegation and role eligibility, activates the profile/user and appends `SITE_USER_CREATED` and `ROLE_ASSIGNED` audit events containing actor, subject, Site and role. Token provisioning rejects PENDING/FAILED profiles, including during the remote enable window. Directory reads exclude inactive users.

Failures remove the new assignment and remote identity. If remote cleanup fails, an inactive FAILED local identity link is retained as a login-blocking tombstone. Audit events record failure and cleanup outcome without credentials. Operator recovery is dry-run by default:

```sh
python manage.py reconcile_site_accounts
python manage.py reconcile_site_accounts --apply
```

The command targets only PENDING/FAILED profiles older than 15 minutes, deletes the recorded provider subject, removes incomplete memberships and local identity, and preserves ACTIVE accounts. `--minimum-age-minutes` is available for controlled rehearsals. If a provider create timed out before returning a subject, the identity was requested disabled and no local assignment is created. A trusted identity operator must inspect that provider-only orphan; recovery never guesses a subject by username or deletes an existing account to make a retry succeed.

## Configuration and deployment

Set a strong backend-only `ACCOUNT_PROVISIONING_SECRET`. Empty disables new-account creation with a recoverable 503 while existing-user assignment continues. `ACCOUNT_PROVISIONING_URL` is the trusted Keycloak internal base URL; the realm is derived from `OIDC_ISSUER`. Use TLS for production browser/backend/provider connections.

The development `keycloak-init` reconciles the confidential `site-user-provisioner` service client when the secret is configured. It grants only `manage-users`, `view-users` and `query-users` on `realm-management`, limits its token scopes accordingly, disables browser/password flows and does not grant realm-admin. Production operators must configure the equivalent dedicated client and secret through their normal secret-management path. Do not put a realm administrator password or this secret in frontend configuration. Application authorization continues to come from database-backed Site assignments, never realm-role claims.

Apply `accounts.0002_account_profile` using the migration DB role, then restart/redeploy the backend and rebuild/redeploy admin-web. Existing accounts/identity links are untouched. The additive migration and reverse migration were exercised on the test database; rollback drops normalized profile images and provisioning state, so resolve incomplete provisioning before any production rollback. [OpenAPI](api/openapi.yaml) and [QA evidence](qa/site-user-create-2026-11-13/README.md) describe the verified contract.
