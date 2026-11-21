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
rendering. Public context includes an opaque `branding_revision` derived from
the effective public identity, eligible logo and module availability. It contains
no storage references or credentials. A public tab refreshes the configuration when it returns to the
foreground, so a saved Site Appearance change is visible on the next request
or tab refocus without editing Page or Builder documents. Logo delivery is
also `private, no-store`. Header/footer logo URLs carry this revision as a safe
`v` query parameter, and dynamic Site Title/Logo widgets revalidate identity
data when the revision changes. Earlier image failures retry on context refresh.
Overlapping focus requests are cancelled so an older response cannot restore
stale branding. When a logo is absent or unavailable, the shared
brand mark renders the UoG text fallback; no broken or private media URL is
shown.

The Main Site and child Sites use the same `PublicSiteChrome`, Site branding
lockup and Material UI theme tokens. `institutional` uses UoG navy/gold with
high contrast text; `high-contrast` uses black/white with yellow accents.
Header, footer, article banners and supported
visual-layout sections use those shared tokens. Branding stays bound to the
request Site and is not copied into individual Page or Builder content.


## Configure Appearance in Site Administration

Choose the active Site in the workspace selector, then select **Appearance** in
its navigation. For example, Informatics uses
`/admin/sites/16/admin/appearance`. The entry and direct route require the
Site-scoped `sites.update` permission; an ordinary Editor or Viewer cannot use
this screen. Django rechecks permissions and ownership on the API request.

Set the public Site title, select a ready image from that Site's Media Library,
and choose Institutional or High contrast. Save appearance updates only
`identity.display_name`, `identity.logo_ref` and `presentation.theme` through the
existing conditional configuration API. A missing logo uses the approved UoG
text mark. Supplied logo images have a transparent presentation background,
no border and a standard 60px desktop / 56px mobile size. Custom
colors, CSS, JavaScript and global template defaults are not editable here.

Configuration saves are effective immediately; there is no separate branding
publication workflow. Public tabs observe changes on their next page load or
return to the foreground. They do not poll in the background. Existing Page
revisions and publication snapshots are unchanged. A failed or conflicting save
preserves form edits and offers an explicit reload of current settings.


The real-browser regression is `scripts/qa-site-branding-refresh.cjs`. It accepts
a private stdin seed with disposable Site-admin credentials, changes the title
and approved theme through Appearance, verifies header/footer/dynamic identity
refresh and Main Site independence, reopens settings, checks the authenticated
logo preview and mobile accessibility, then restores the original appearance.
[Recorded browser results](../qa/site-branding-refresh/2026-11-21/results.json)
and [mobile screen](../qa/site-branding-refresh/2026-11-21/appearance-mobile.png)
are available. The test identities were disabled and their Site grants revoked
after verification; no credentials are included in these artifacts.
