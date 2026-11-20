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
| `presentation` | `theme` | `institutional` (approved UoG navy and gold palette) or `high-contrast` (approved black, white and yellow palette). |
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

## Public Site branding

The shared public renderer resolves its initial branding from the request
hostname through `GET /api/v1/site-context/`. The response contains only the
resolved Site's public title, approved theme token and a fixed logo route when
the Site-owned image is still ready and eligible. It never accepts a Site id
or media URL from the browser. The response is `private, no-store` and varies
by Host; public clients also request it with `cache: no-store`.

Every document request receives the current configuration during server
rendering. A public tab refreshes the configuration when it returns to the
foreground, so a saved Site Appearance change is visible on the next request
or tab refocus without editing Page or Builder documents. Logo delivery is
also `private, no-store`. When a logo is absent or unavailable, the shared
brand mark renders the UoG text fallback; no broken or private media URL is
shown.

The Main Site and child Sites use the same `PublicSiteChrome`, Site branding
lockup and Material UI theme tokens. `institutional` uses UoG navy/gold with
high contrast text; `high-contrast` uses black/white with yellow accents.
Header, footer, Page/homepage document headers, article banners and supported
visual-layout sections use those shared tokens. Branding stays bound to the
request Site and is not copied into individual Page or Builder content.
