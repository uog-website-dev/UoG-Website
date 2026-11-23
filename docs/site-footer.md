# Site footer administration

Open **Site Administration → Footer** with Site settings permission. Main and child Sites share this screen and renderer; each saves its own settings.

Configure the description, contact details, optional featured link, copyright and up to seven social profiles. Reorder social profiles using the labelled arrow controls. Only configured fields appear publicly. The logo and title follow Appearance automatically. Copyright supports `{year}` and `{site}`. Arbitrary HTML, CSS and JavaScript are not interpreted.

For columns, open **Menus**, create parent items such as Essentials, About us, Resources and Quick links, then add their child links. Publish the menus and their Footer location assignment. The Footer screen lists each assigned menu as a column: edit its **public heading**, an optional **description**, and use the arrows to set the public order. The internal menu name stays internal; renaming the menu never changes the public heading. Link destinations retain the existing ownership and safe-URL validation. Disabling MENUS hides navigation links.

Footer text, contact, social and column copy save as a **private draft**. Nothing reaches visitors until **Publish footer**. The draft preview on the same screen shows draft values with the Site's currently published footer links; visitors keep seeing the last published values. Menu edits continue to require their own publication. Reload resolves the current hostname-scoped published settings. Social links require HTTPS and open in a new tab. No account is assumed or fabricated.

### Draft, publish and lint

- **Save draft** requires the strong ETag from GET in `If-Match`; missing preconditions return 428 and stale edits return 412. Failed saves preserve editor input.
- **Publish footer** snapshots the saved draft, records `published_at`/`published_by`, keeps the outgoing publication as `previous_published_settings`, and emits `SITE_FOOTER_PUBLISHED`. Publish is disabled while unsaved edits exist; save first.
- **Restore previous published footer** copies the previous published snapshot back into the draft and emits `SITE_FOOTER_RESTORED`. Publication does not change until the restored draft is published again.
- The pre-publish copy lint **blocks** placeholder text (`lorem`, `tbd`, `placeholder`), QA/review/internal wording (`QA`, `review`, `staging`, `test site`) and design-reference wording (`used as a private design reference`) with a field-level message. Duplicate public column headings are non-blocking **warnings** returned on the publication response. Only display text is scanned; URLs and contact values keep their existing validators.
- Publication additionally revalidates the saved draft, including column menu ownership. Two publishes are needed before a previous publication exists; the envelope exposes `previous_available`.

The endpoint is `GET/PATCH /api/v1/sites/{id}/footer/`, with `POST footer/publish/` and `POST footer/restore-previous/` using the same ETag in `If-Match`. The envelope returns `settings` (draft), `published_settings`, `has_unpublished_changes`, `published_at`, `previous_available`, `columns` (editor rows with `menu_name`) and `lint_warnings` on publish. Authorization uses live `sites.update` permission; another Site's identifier returns 403 even on direct API calls. Public configuration is resolved by hostname and remains no-store. Footer settings are included in the existing Site context request.

Migration sites.0013 adds one optional settings row per Site, immutable ownership, server-managed version and audited writes. Migration sites.0016 adds explicit footer columns and the publication snapshots, seeding the published copy from existing settings so visitors see no change on deploy. Reversing 0016 removes columns and publication history, so export published snapshots before rollback; draft values remain in their original columns and menus/branding stay separate. Reverse/forward rehearsal completed locally on 2026-11-23. No Page schema changes are required.

Validation evidence: backend footer API and hostname-resolution tests; frontend footer safety and public-chrome regressions; validated OpenAPI snapshot at docs/api/openapi.yaml. External review and Issue attachment remain owner actions.

## Verification — 2026-11-22

- sites.0013 applied locally; empty-table rollback to 0012 and forward reapply succeeded. `makemigrations --check --dry-run` found no missing migrations.
- Footer API: 2 integration tests passed, including ETag conflicts, invalid fields/URLs, immutable ownership, audit actor, anonymous denial, foreign-Site denial and hostname-scoped public configuration. Existing hostname-resolution suite: 8 tests passed. Organization boundary/regression suite: 9 tests passed.
- Footer renderer, editor conflict preservation, public chrome and Site navigation matrix: 18 component tests passed.
- Validated OpenAPI with `spectacular --validate --fail-on-warn`; snapshot updated. Admin typecheck and isolated admin/public production builds passed.
- `node scripts/qa-public-presentation.cjs`: Main, Informatics and Agriculture at 390/768/1440 px; no overflow, one header/footer/H1, zero axe WCAG A/AA violations in those fixtures.
- `scripts/qa-site-footer.cjs`: real Keycloak Site Administrator login, editor save, anonymous Informatics delivery, independent Main footer, mobile editor at 390 px and zero axe violations. Temporary text restored and generated accounts disabled/grants revoked. Local screenshots/result: `.git/task-data/footer-review/`. This script accepts a private disposable review seed through stdin; never commit or print credentials.

Automated accessibility checks cover the exercised fixtures and do not substitute for a full manual accessibility audit. No external reviewer approval or Issue attachment is claimed.


Newsletter and support: configure labels plus approved HTTPS destinations in Footer. The newsletter opens a hosted subscription form; the support control opens a configured helpdesk/chat service. Both are hidden by default and are independent per Site. No subscription addresses, provider keys or chat credentials are collected by these controls. Migration sites.0014 adds these fields and database URL guards. Export settings before downgrading; run code and schema rollback together.


## Multiple menu columns

In Site Administration > Menus > Template menu locations > Footer, choose Add footer column. Select up to four distinct local menus, reorder with Move left, or remove a column. Its published items form the column; the public heading and description are edited on the Footer screen and do not follow the internal menu name. Publish the menus themselves first, then save the footer draft and publish it. Removing every column and publishing explicitly unassigns the footer without deleting menus. Other slots continue to accept one menu.

The menu region uses equal fractional widths: one column on phones, two on tablets, and the configured column count (up to four) on wide screens. Branding/contact information remains a separate region. Empty published menus retain their heading. Retired menus disappear safely. Existing legacy single-menu/grouped-item footers retain their prior behavior until explicitly configured as columns.

API: POST menus/locations/footer/draft/ accepts version, menus (ordered UUID array, zero to four), replace. Use either menus or legacy menu, never both. Draft/published arrays are returned alongside backwards-compatible first-menu fields. Version checks, replacement confirmation, Site/module/role gates, private previews and atomic promotion apply to the whole ordered set. Database guards prevent duplicate/foreign/global references and deletion or centralization of assigned column menus. Owner slot cache generations refresh when any named menu changes.

Deployment requires CMS migration 0029_footer_menu_columns and updated backend/admin/public services. Rollback was rehearsed locally before any multi-column assignments: downgrade refuses while any draft or publication contains more than one menu; first reduce and publish each affected footer to one menu or none. Rollback preserves that primary menu. Evidence: qa/footer-menu-columns-2026-11-22/.

Footer Publish remains available for valid saved assignments even when they match the current public assignment. A successful save is reconciled from the server response. If subsequent publishing fails, the saved draft and its new version remain visible with a retryable error.
