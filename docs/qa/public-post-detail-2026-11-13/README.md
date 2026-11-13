# Public Post detail (visitor article) — 2026-11-13

Evidence pack for the Website Visitor published article detail capability (P4-F-POST public delivery).

## Acceptance criteria

| AC | Evidence |
| --- | --- |
| AC-01 Published Site A article at configured public URL | Host-resolved `GET /api/v1/site-context/posts/{slug}/`; public-web `/posts/{slug}`; `test_public_posts.py` |
| AC-02 Safe rich-text headings, lists, quotes, images | `ArticleDocumentView` + `public-post.test.tsx` / `article-document.test.tsx` |
| AC-03 Unpublished / withdrawn inaccessible | Draft and unpublish → API 404; FE renders empty status |
| AC-04 Site B slug does not resolve under Site A | Host isolation cases in `test_public_posts.py` |
| AC-05 Unknown slug → approved not-found | API 404; FE “no published post” status (same Site soft-empty contract as pages) |
| AC-06 Missing featured media → no broken image | Compact `FeaturedImageWidget` returns null; renderer test |
| AC-07 POSTS disabled → module-disabled 404 contract | `_require_posts_module` + disabled-module tests |
| AC-08 Responsive + accessibility | Semantic `<article>`, `<h1>`, `<time>`, back link to `/posts`; responsive typography |

## Artifacts

- [backend-tests.txt](backend-tests.txt) — public Post API isolation, module gate, author byline, snapshot binding
- [renderer-tests.txt](renderer-tests.txt) — shared UI feed/detail, SEO helpers, article document sanitization
- [PR.md](PR.md) — change summary for review / Issue attachment

## Guidance

- [Public Post API](../../api/posts.md)
- [OpenAPI](../../api/openapi.yaml)

Independent PR creation and Azure DevOps Issue attachment remain pending.
