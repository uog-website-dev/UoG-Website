# Site configuration schema

Implementation date: 2026-10-27. Site settings live on `Site.configuration`.
This is a versioned allowlist, not a free-form document and not a second
table. `Site.default_language` stays a real column because it is queried
with the property itself. Logo and favicon values are nullable media keys.
This story does not upload files.

## Schema version 1

| Section | Keys | Rules |
| --- | --- | --- |
| `schema_version` | `1` | Required. Unknown versions are rejected. |
| `identity` | `display_name`, `logo_ref`, `favicon_ref` | Display name is null (use `Site.name`) or a trimmed name of at most 255 characters. Media keys are null or lowercase letters, digits, underscores and hyphens. URLs are not references. |
| `language` | `enabled` | One to ten unique normalized language codes. Must include `Site.default_language`. |
| `presentation` | `theme` | `institutional` (default) or `high-contrast`. |
| `navigation` | `items` | Up to 20 objects with `code`, `label` and a same-site `path` such as `/` or `/about`. Codes are unique. |
| `behavior` | `show_search`, `show_language_switcher` | Booleans, default false. |

An omitted document or `{}` is stored as the version 1 defaults for that
site's default language. Unsupported keys are rejected. Keys whose names
contain password, secret, token, credential, api key, private key or session
are rejected. Defaults are built per save, so two sites never share one
configuration object.

`apply_site_configuration(site_id, changes)` merges an allowlisted partial
change onto that site only. Assigning `configuration` on the model replaces
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
