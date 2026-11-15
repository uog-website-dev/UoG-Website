# Site navigation rendering and draft preview

Registered template locations use the shared header, utility header, footer and Page sidebar renderers for Main and child Sites. Existing published menu snapshots and location assignments remain authoritative for anonymous delivery. This change requires no migration.

## Editor workflow

In Site Administration ? Menus, choose **Preview draft navigation** to open the saved draft assignments in a new tab. A menu's individual preview link opens its saved working item tree. Save edits first: preview does not include unsaved form values, approve content, or publish assignments. Refresh the preview after another save. The current-path control simulates active-link indication; the center region is contextual guidance rather than a Page content preview.

Preview uses the active Site and requires menu read/write permissions and the MENUS module. The authenticated endpoints are:

- `GET /api/v1/sites/{site}/menus/preview-navigation/`
- `GET /api/v1/sites/{site}/menus/{menu}/preview/`

Responses are private/no-store, vary by Authorization/Cookie, and disallow indexing. The browser uses the existing authenticated server client; no access token is put in a preview URL. Site changes clear the former preview. A rejected refresh removes the former canvas rather than continuing to show stale private data.

## Destination and fallback policy

Public rendering resolves published, eligible Site-owned destinations. Unavailable nodes and their descendants are omitted. Private preview retains unavailable working items as unlinked warnings. A missing or empty location renders an empty region safely. MENUS disabled removes public navigation while the Page remains available under its own module policy.

Local relative destinations resolve under the current public Site. Preview qualifies them using the Site's active primary hostname; without that hostname relative preview links are disabled. Published inherited/global internal links use their owning Site's canonical origin rather than accidentally resolving under the child Site. Private parent drafts are never inherited. DEBUG uses HTTP origins; deployed delivery uses HTTPS.

Both projections and the shared client bound menu trees to four levels and 1,000 nodes. The client rejects unsafe schemes, protocol-relative URLs, credentials, malformed encoding and encoded control/backslash values. Labels render as escaped React text. The backend remains responsible for destination eligibility and write validation.

## Accessibility and responsive behavior

Exact same-origin pathname matches receive `aria-current="page"`, bold text and underline; a parent pathname alone does not match a child route. A configured query/hash must also match. Links wrap and have visible focus outlines and touch targets. Mobile navigation has an explicitly labelled trigger and close control, bounded viewport width, Escape dismissal, focus restoration and dismissal after navigation. Native nested disclosure summaries remain keyboard operable; Escape returns focus to the summary.

See [verification evidence](qa/menu-rendering-2026-11-15/README.md) and the [OpenAPI baseline](api/openapi.yaml). Existing domain-link helper changes in this workspace are independent of this navigation story.
