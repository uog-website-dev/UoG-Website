# Public hostname routing and publication cache — 2026-11-12

Public visitors open the correct homepage and published Pages by hostname.
Trusted Host resolution selects the Site before homepage or Page publication
lookup. Caches include Site, locale, publication generation and route resource.
Assignment, publication and unpublication invalidate affected entries without
changing other Sites. Draft edits never enter public delivery, including warm
cache.

## Contracts and implementation

- Public Site wiring: [public-site.md](../../development/public-site.md)
- Homepage assignment/fallback: [site-homepage.md](../../architecture/site-homepage.md)
- Host middleware: `backend/apps/sites/middleware.py`
- Public CMS routes: `backend/apps/cms/api/public.py`
- Cache generations: `backend/apps/cms/services/publication_cache.py`
- Coverage: [backend.xml](backend.xml), [ui.xml](ui.xml)

## Evidence attachments

| Artifact | Role |
| --- | --- |
| [cache-invalidation-traces.json](cache-invalidation-traces.json) | Key design + two-Site invalidation traces |
| [slider-isolation.xml](slider-isolation.xml) | Same-slug Slider isolation case |
| [backend.xml](backend.xml) | Host routing, homepage assignment, resolution, unpublish cache |
| [ui.xml](ui.xml) | public-site / public-page shared client behavior |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Two Sites with the same slug render independent content | **PASS** | `campus` slug on Informatics vs Medicine with different Slider text |
| Root reflects assignment or documented fallback | **PASS** | Assigned root 200; unpublish → 404 empty-root, pointer retained |
| Draft edits cannot change public content (warm cache) | **PASS** | Draft routes 404; visual draft changes leave public snapshot |
| Same Page slug + different Slider + homepage assignments | **PASS** | Warm both hosts, reassign Informatics; Medicine body/version/assets unchanged |

## Results

| Verification | Result |
| --- | --- |
| Backend two-host / cache / assignment | 18 passed ([backend.xml](backend.xml)) |
| Shared public UI helpers | 14 passed ([ui.xml](ui.xml)) |

Browser multi-host E2E through nginx remains waived; API Host-header tests
exercise the same site-context routes the public-web app calls.
