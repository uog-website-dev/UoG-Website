# Site footer administration

Open **Site Administration → Footer** with Site settings permission. Main and child Sites share this screen and renderer; each saves its own settings.

Configure the description, contact details, optional featured link, copyright and up to seven social profiles. Reorder social profiles using the labelled arrow controls. Only configured fields appear publicly. The logo and title follow Appearance automatically. Copyright supports `{year}` and `{site}`. Arbitrary HTML, CSS and JavaScript are not interpreted.

For columns, open **Menus**, create parent items such as Essentials, About us, Resources and Quick links, then add their child links. Publish the menu and publish its Footer location assignment. Parent labels become column headings; existing flat menus remain supported. Link destinations retain the existing ownership and safe-URL validation. Disabling MENUS hides navigation links.

Footer text/contact/social settings take effect immediately after Save; open public tabs refresh on returning to the foreground, and reload always resolves current hostname-scoped settings. Menu edits continue to require publication. Preview does not publish or modify a Page. Social links require HTTPS and open in a new tab. No account is assumed or fabricated.

The endpoint is `GET/PATCH /api/v1/sites/{id}/footer/`. PATCH requires the ETag from GET in `If-Match`; missing preconditions return 428 and stale edits return 412. Failed saves preserve editor input. Authorization uses live `sites.update` permission. Public configuration is resolved by hostname and remains no-store. Footer settings are included in the existing Site context request.

Migration sites.0013 adds one optional settings row per Site, immutable ownership, server-managed version and audited writes. Existing Sites need no backfill. Reversing to 0012 removes footer settings, so export them before rollback; menus and branding remain separate and preserved. Local empty-table reverse/forward rehearsal completed on 2026-11-22. No Page schema changes are required.

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

In Site Administration > Menus > Template menu locations > Footer, choose Add footer column. Select up to four distinct local menus, reorder with Move left, or remove a column. Each menu name is its heading; its published items form the column. Publish the menus themselves first, then Publish Footer (which saves changed column selections first), or save a private draft separately. Removing every column and publishing explicitly unassigns the footer without deleting menus. Other slots continue to accept one menu.

The menu region uses equal fractional widths: one column on phones, two on tablets, and the configured column count (up to four) on wide screens. Branding/contact information remains a separate region. Empty published menus retain their heading. Retired menus disappear safely. Existing legacy single-menu/grouped-item footers retain their prior behavior until explicitly configured as columns.

API: POST menus/locations/footer/draft/ accepts version, menus (ordered UUID array, zero to four), replace. Use either menus or legacy menu, never both. Draft/published arrays are returned alongside backwards-compatible first-menu fields. Version checks, replacement confirmation, Site/module/role gates, private previews and atomic promotion apply to the whole ordered set. Database guards prevent duplicate/foreign/global references and deletion or centralization of assigned column menus. Owner slot cache generations refresh when any named menu changes.

Deployment requires CMS migration 0029_footer_menu_columns and updated backend/admin/public services. Rollback was rehearsed locally before any multi-column assignments: downgrade refuses while any draft or publication contains more than one menu; first reduce and publish each affected footer to one menu or none. Rollback preserves that primary menu. Evidence: qa/footer-menu-columns-2026-11-22/.

Footer Publish remains available for valid saved assignments even when they match the current public assignment. A successful save is reconciled from the server response. If subsequent publishing fails, the saved draft and its new version remain visible with a retryable error.
