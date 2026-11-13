# Visual Builder shell verification

The [workspace policy](../../architecture/visual-builder-shell.md) documents
navigation, access, insertion, private draft saves and rendering boundaries.
The existing [OpenAPI](../../api/openapi.yaml) supplies `visual-draft/` and
`working-draft/`; this UI story adds no endpoint or database migration.

## Automated evidence

- [Admin/navigation/keyboard regression](admin.xml): actual Page route mounted
  within Site Administration, disabled and view-only direct navigation, malformed
  routes, loading/empty/error/retry, initial heading focus, 43-card search and
  category counts, arrow/Enter insertion, Escape/invoker focus restoration,
  nested outline selection, focus mode, delayed Page/Site responses, working-draft
  entry, canonical saves, conflict preservation and local undo.
- [Backend contract/draft regression](backend.xml): common widget fixtures,
  malformed trees, limits, immutable IDs, scoped draft persistence/media inventory,
  conditional conflicts and preservation of the public snapshot.
- [Shared admin/portal renderer regression](portal.xml): common visual fixtures,
  legacy rendering and public/private image URL isolation.
- [Final shell regression](final.xml): rechecks the complete shell and all 43
  default configurations after the final context-label and Unicode-alt changes.

Results: 45 admin tests, 120 backend cases, 69 renderer tests and 14 final shell
tests passed with zero failures. Workspace TypeScript passed across all five
checked packages. The contract generator and whitespace checks pass. Admin-web
was restarted locally; this story requires no new dependencies or migration.

The catalog helper checks all 43 initial widget configurations against the shared
schema, validates the 60/40 nested starter, rejects stale insertion contexts and
checks insertion bounds. Navigation asserts the Pages-list link retains the
active Site and Page ID. The context-switch scenario opens the inspector, focus
mode and picker, changes Page and then Site, delivers the old result late, and
verifies the former controls and metadata do not return.

The backend run exposed an old migration rehearsal using today's Site ORM after
downgrading past the new homepage FK. The rehearsal now prepares a complete
revisioned legacy fixture before downgrade, reads the old baseline through the
historical model, and verifies the upgraded Page through the current model. It
does not bypass the CMS revision-write guard to create partial history.

## Browser and responsive status

Browser visual verification was attempted through Computer Use. The embedded
browser host was unavailable. The native Chrome fallback stopped because the
tool could not verify the current browser URL with sufficient confidence to
enforce policy. No browser screenshot or full-stack seeded-user E2E result is
claimed. Component tests exercise the actual route/controls and backend tests
exercise the real gates, but these do not replace a browser responsive check.

A reproducible client-only fixture lives in
`frontend/scripts/qa/visual-builder/`. It imports the production workspace with
isolated Page actions and has Editor, Viewer and PAGES-disabled presets plus
Site/Page selectors. It uses in-memory fake draft data, no auth credentials and
no live Site or MinIO writes. Its browser bundle builds successfully; Vite reports
the expected `use client` directive warnings outside Next and a bundle-size
warning. This fixture is not a production route or an authentication test.

From the repository root, start it with:

```powershell
docker compose run --rm --no-deps --name uog-builder-qa -p 127.0.0.1:4175:4175 frontend-admin node /workspace/scripts/qa/visual-builder/serve.mjs
```

Open `http://localhost:4175/` at desktop and 390px widths. Search Slider, insert
Layout Slider, select its Headline from the outline, switch Sites and verify
inspector reset. Exercise Viewer/disabled presets, focus mode and keyboard focus
restoration. The fixture deliberately mocks the media dialog; use the normal
application with authorized accounts for real media and full-stack E2E checks.
Stop the fixture with `docker stop uog-builder-qa`; the verification session's
temporary fixture container has been stopped.
