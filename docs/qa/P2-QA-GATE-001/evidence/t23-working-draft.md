# T23 — working draft while a Page stays published

Date: 3 November 2026. Stack: local compose project, nginx at `http://localhost`, public Host `www.uog.local`, Main Site id 1.

## Decision

A published Page stays locked. `POST /api/v1/sites/{site_pk}/pages/{id}/working-draft/` opens one DRAFT Page copied from the current serving snapshot. The draft uses an internal `wip-` slug and `draft_of` points at the published Page. Submit, review, and publication use the existing workflow. Publishing the draft copies the approved title, blocks, metadata, SEO, layout, and visibility onto the published Page, writes the next snapshot, bumps that Site and locale publication version, and archives the draft. The public id, slug, and path stay the same.

The contract is in [cms-workflow](../../../architecture/cms-workflow.md).

## Migration

`cms.0012_page_working_draft` applied as the schema owner. Afterward the live database had 6 Pages, 0 working drafts, and 3 publication snapshots. Existing Pages received an empty `draft_of`. Snapshots were not rewritten.

## API sequence

Actors: the development platform administrator as author, plus separate reviewer and publisher accounts with Site CMS roles. Those accounts were disabled and their role assignments revoked after the run.

| Step | Result |
| --- | --- |
| Create, submit, approve, and publish `t23-visitors` | Public title `T23 visitors`, publication version 1 |
| PATCH the published Page | 400 |
| Open and PATCH the working draft | 201, then draft title `T23 visitors revised` |
| Public read while the draft was open and in review | 200, title `T23 visitors`, version 1 |
| Author approves the draft | 403 |
| Reviewer approves and publisher publishes | Draft `ARCHIVED`; public title `T23 visitors revised`, version 2 |
| Unpublish the live Page | Public read 404 |

The internal draft route was not publicly served. Automated coverage is `backend/apps/cms/tests/test_working_draft.py`, including a failed snapshot rollback, archive without changing the live Page, one-winner concurrent publication, and an unchanged Post publish path.

## Browser

Signed in to `http://localhost/admin/sites/1/admin/pages`. The published row offered **Edit draft**. The dialog title was "Edit draft of published Page", the title was the draft text, and the slug `wip-1fb527465a34` was disabled. `www.uog.local` is not in this machine's hosts file, so the browser did not open that hostname. Public isolation was checked through nginx with that Host header. The Next.js document is client-rendered, so the title is not in the first HTML response; the public JSON is what that page fetches.

The probe Page was unpublished after the check and remains on Main Site in the unpublished state.
