# Published homepage assignment

`Site.homepage` is a nullable, protected Page foreign key. One Site row stores
one assignment; it does not move or modify the Page, its revision number,
approval, publication snapshot, media references or route. This keeps reviewed
visual slides, column order and presentation frozen while changing root routing.

## Assignment contract

`POST /api/v1/sites/{site_pk}/pages/{id}/homepage/` accepts an empty object.
Authentication and persisted, scoped `sites.update` permission are required.
Platform administrators use their persisted platform grant. An editor's CMS
AUTHOR role alone does not grant Site configuration permission. PAGES must be
available globally and for the target Site.

The service validates the stored Page under the shared hierarchy write lock and
a Site row lock: same Site, PUBLISHED, PUBLIC or UNLISTED, enabled locale, no
working-draft identity, and an existing published snapshot. A draft, hidden or
otherwise ineligible Page returns 400. A foreign Page on the scoped URL returns
404 without disclosing its metadata. Missing permission returns 403. Failed
requests change neither the assignment, audit history nor cache generation.
Repeating the same eligible assignment is a no-op.

Success returns the existing Page representation, including computed
`is_homepage` and `can_set_homepage`. Site detail also exposes the read-only
`homepage` UUID. Generic Site PATCH/configuration cannot assign this field.
Django admin displays it read-only. The administration Page table offers
**Set homepage** only for a published row authorized by the backend. The endpoint
rechecks eligibility and permission even when the button was previously shown.

Assignment and unpublication share the CMS hierarchy lock. If unpublication
wins, assignment rejects the Page. If assignment wins, later unpublication
preserves the configured pointer and the next root read uses the fallback.
Concurrent assignments serialize; the last successful assignment wins. This
action has no optimistic Page-version precondition because it changes Site
settings, not Page authoring state.

## Root fallback decision

The trusted Host resolves the existing Site/domain identity. Both public root
lookup paths use the same selector and check the selected Page's current Site,
locale, publication state, visibility and snapshot before returning it.
Anonymous requests always serialize the immutable publication snapshot.

An explicit assignment which loses eligibility returns 404 from the homepage
API. The portal uses its existing empty Page state. There is no automatic switch
to the first Page, previous Page, legacy flag, working draft or another Site.
The pointer is retained so publishing the same Page again can restore its root
without silently changing administrator intent. A new eligible assignment can
replace it at any time. Turning PAGES off also makes the root unavailable.

Migration `sites.0010_published_homepage` copies existing `is_homepage` flags to
the Site setting before installing write guards. This preserves Sprint 2
configuration, even for an existing flag whose Page is not yet eligible; public
reads still refuse that Page until eligible. Legacy fixtures/restore operations
may retain their Page flags. When no explicit setting exists, the compatibility
selector can use that old flag. Once a Site has an explicit setting, it always
takes precedence. Legacy flag changes cannot replace it.

## Audit and route invalidation

The database requires the assignment service write context and validates the
same-Site publication boundary, including queryset/bulk/SQL writes. A successful
changed setting records `SITE_HOMEPAGE_ASSIGNED` on `sites.site`, with the Site ID,
actor, old/new `homepage` UUIDs, request context and changed field. The audit
trigger joins the assignment transaction; writer/audit failure rolls it back.

The transaction advances publication generations only for the selected Site's
affected locales (old and new assignment locales). Generation keys isolate its
cached Page/list/root-facing responses; other Sites' generations and warmed
entries remain intact. Cache deletion callbacks run after commit through the
existing publication cache service. Unpublication uses the existing workflow
invalidation path, and eligibility is checked before cache access. Success and
empty-root responses use `max-age=0, must-revalidate` and `Vary: Host`.

Published Page responses compute their homepage designation from Site settings;
the original snapshot remains unchanged. Response ETags include the Site/locale
generation so routing-setting changes do not retain the old representation.

See [OpenAPI](../api/openapi.yaml) and
[two-host, upgrade and race evidence](../qa/homepage-2026-11-12/report.md).
