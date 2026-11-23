# Site header administration

Open **Site Administration → Header** with Site settings permission. Each Site saves and renders its own header; the Main Site and every child Site use the same screen and the same public component as the live Site.

Configure the destination of the logo and Site name, whether search appears, sticky behaviour, a call-to-action button and the language-switcher preference. The logo, display name and theme continue to follow **Appearance**.

- **Logo and Site name link** accepts a same-site path such as `/` or `/about`, or an absolute `http(s)` URL. Empty values, protocol-relative URLs, credentials in URLs, control characters and `javascript:`/`data:` destinations are rejected.
- **Call to action** needs both a label and a destination. A label without a destination, or a destination without a label, fails validation. Only safe destinations are rendered.
- **Search** additionally requires PAGES or POSTS to be enabled for the Site. Turning the switch on has no effect while both modules are off.
- **Sticky** keeps the header visible while scrolling.

**Navigation.** The header and utility menus are not configured or stored here. Assign the existing `header` and `secondary` menu locations under **Menus → Template menu locations** and publish them there. The Header screen shows which menus are currently published and warns when a newer assignment is still a draft; the live preview renders published menus only, exactly as visitors see them. Disabling MENUS removes navigation from the public header.

**Saving and publication.** Header settings save as a **private draft**; nothing changes for visitors until **Publish header**. Publish snapshots the saved draft, records `published_at`/`published_by`, keeps the outgoing publication as `previous_published_settings` and emits `SITE_HEADER_PUBLISHED`. **Restore previous published header** copies that snapshot back into the draft (`SITE_HEADER_RESTORED`); publish again to make it public. Publication is disabled while unsaved edits exist. The pre-publish copy lint blocks placeholder, QA/review and design-reference wording in the call-to-action label with a field-level message. Published pages pick up a new header when their tab refreshes or on reload. Unsaved edits appear only in the draft preview on this screen. The form preserves input when validation fails or another session saves first; reload current settings before retrying a conflict.

**Language switcher.** The preference is stored and validated, but this platform does not yet serve locale-prefixed public routes, so no switcher control is rendered. It is hidden by default and is not a placeholder.

## Contract and authorization

`GET/PATCH /api/v1/sites/{id}/header/`, plus `POST header/publish/` and `POST header/restore-previous/`. All writes require the ETag returned by GET in `If-Match`: missing preconditions return 428 and stale versions return 412 with the current version. Unknown fields and invalid values return field-level errors and persist nothing. Reads and writes require `sites.update` on that Site and either the MENUS or PAGES module; other Sites' identifiers return 403, including direct publish/restore calls. The envelope returns `settings` (draft), `published_settings`, `has_unpublished_changes`, `published_at`, `previous_available` and, on publish, `lint_warnings`. Public output is the published snapshot, resolved by hostname from the existing Site context request, and stays `no-store`.

No raw HTML, CSS or JavaScript is accepted anywhere in the contract.

## Schema and rollback

Migration `sites.0015_site_header_settings` adds one optional settings row per Site with immutable Site ownership, a server-managed version and audited writes (`SITE_HEADER_CREATED`). Migration `sites.0016_footer_header_publication` adds the publication snapshots and seeds the published copy from existing values, so visitors see no change on deploy. Existing Sites need no backfill and keep the safe default header (logo/name linking to `/`, search on, no CTA, not sticky). Reversing 0016 removes publication history, so export it before rollback; reversing 0015 removes header settings only; menus, branding and footer settings are untouched. Reverse/forward rehearsal completed locally on 2026-11-23. Export settings before downgrading a Site that has real values.

## Verification

- Backend: Site isolation, RBAC (including direct API access without `sites.update`), MENUS/PAGES gate, field validation (unsafe URLs, URL/label coupling, unknown fields), ETag 428/412, immutable ownership, audit actor and hostname-scoped public configuration.
- Frontend: public header component tests (menus, search gating, CTA safety, sticky) and Header panel tests (real-component preview, mobile viewport, field errors, draft save, publish, restore and disabled-until-saved publish).
- Footer publication tests cover draft privacy, public published values, ETag 412/428 on publish, lint blocking (`review`, design-reference wording), duplicate-heading warnings, restore, audit events, menu ownership and cross-Site denial. Page publication records non-blocking `lint_warnings` for multiple h1 headings and missing image alt text in the `CONTENT_PUBLISHED` audit event.
- Migration `sites.0016` applied, reversed to `sites.0015` and reapplied locally with existing footer rows preserved.
- OpenAPI snapshot regenerated with `spectacular --validate --fail-on-warn` into `docs/api/openapi.yaml`.

Automated checks cover the exercised paths and do not replace a manual accessibility audit or an external reviewer sign-off.
