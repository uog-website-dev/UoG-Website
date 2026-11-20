# Site configuration schema

Implementation date: 2026-10-27. Site settings live on `Site.configuration`.
This is a versioned allowlist, not a free-form document and not a second
table. `Site.default_language` stays a real column because it is queried
with the property itself. Appearance uses the Site title, an optional ready
Site-owned logo and approved theme palettes. The schema has no custom CSS,
JavaScript, or arbitrary color input.

## Schema version 1

| Section | Keys | Rules |
| --- | --- | --- |
| `schema_version` | `1` | Required. Unknown versions are rejected. |
| `identity` | `display_name`, `logo_ref`, `favicon_ref` | Display name is null (use `Site.name`) or a trimmed name of at most 255 characters. A configured logo is a ready PNG, JPEG, or WebP asset owned by this Site. URLs and foreign Site assets are rejected. |
| `language` | `enabled` | One to ten unique normalized language codes. Must include `Site.default_language`. |
| `presentation` | `theme` | `institutional` (approved UoG navy and gold palette) or `high-contrast` (approved black and white palette). |
| `navigation` | `items` | Up to 20 objects with `code`, `label` and a same-site `path` such as `/` or `/about`. Codes are unique. |
| `behavior` | `show_search`, `show_language_switcher` | Booleans, default false. |

An omitted document or `{}` is stored as the version 1 defaults for that
site's default language. Unsupported keys are rejected. Keys whose names
contain password, secret, token, credential, api key, private key or session
are rejected. Defaults are built per save, so two sites never share one
configuration object.

`apply_site_configuration(site_id, changes)` merges an allowlisted partial
change onto that site only. When `logo_ref` changes, the service verifies the
asset owner, readiness, image type, and Site Media module availability. Public
identity context and logo delivery resolve the asset again on the request Site;
unavailable logos use the accessible UoG text fallback. Assigning
`configuration` on the model replaces
the document, with omitted sections restored from defaults only when the
stored value is empty or still the untouched factory default.

## Extension and rollback

Add a new schema version in `apps.sites.configuration` with an entry in
`UPGRADES` that rewrites the previous document, then ship a migration.
Do not accept client-defined keys. Restoring an older document through a
product workflow is deferred. `SITE_CONFIGURATION_CREATED` and
`SITE_CONFIGURATION_UPDATED` audit events store the allowlisted before/after
documents in the same database transaction. Status-only lifecycle changes
do not emit a configuration event.

PostgreSQL validates the same envelope on every insert and update, including
writes that bypass the ORM. `sites.0002_site_configuration` backfills older
`{}` values, installs that check, and adds the audit trigger.
