## Summary

- Hardens the host-resolved public Post detail experience for Website Visitors: publication date, optional author byline, SEO document metadata, back navigation to `/posts`, and clean omission of missing featured media.
- Captures an optional public `author` byline in the publication snapshot (display name only; no author ids or workflow fields on the public contract).
- Extends shared renderer and API tests for AC-01–AC-08 behaviors already gated by Site Host resolution and the POSTS module.

## Test plan

- [x] `pytest apps/cms/tests/test_public_posts.py`
- [x] OpenAPI live contract includes public Post `author` and existing post preview/working-draft paths
- [x] `pnpm test` for `public-post`, `public-site`, and `article-document` in `@uog/ui`
- [ ] Browser pass on a published `/posts/{slug}` under an active Site hostname (desktop + mobile)
- [ ] Attach linked PR and this QA folder to the Azure DevOps Issue
