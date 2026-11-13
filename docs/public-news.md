# Public news listing

Visitors open `/posts` on the current Site hostname. News cards show the approved title, excerpt, publication date, first approved category when available, and a featured thumbnail. Cards use a three-column desktop grid, two columns on tablets and one column on mobile. Their detail links use the existing `/posts/{slug}` route on the same hostname.

An absent, foreign or unavailable featured image uses the shared document-icon panel. A thumbnail failure preserves the card and its article link. Images use the existing host-resolved Media delivery endpoint with `variant=thumbnail`. Original storage paths and credentials stay on the server.

## Listing contract

```text
GET /api/v1/site-context/posts/?page=1&page_size=20
```

The response retains `count`, `next`, `previous` and `results`. Summaries include stable article and Site IDs, title, slug, excerpt, approved taxonomy, featured asset reference and alternative text, publication timestamp and publication version. Body documents, private metadata and review comments are excluded. Existing public author and SEO fields remain in the summary contract.

The default page size is 20. Page sizes from 1 through 100 are accepted. Invalid or excessive sizes return HTTP 400 with a `page_size` field error. Page numbers must be positive decimal integers. Malformed numbers return HTTP 400, and a positive page beyond the available range returns HTTP 404. Repeated parameters and unknown parameters, including `site` and `site_id`, are rejected.

The trusted hostname determines the Site. Enabled-language selection and active Site taxonomy filters use the existing `locale`, `category` and `tag` parameters. The POSTS module gates public delivery. Eligible records have published status, an original article identity, a serving publication snapshot and publication timestamps at or before the current time. Drafts, working copies, unpublished articles and future publications are excluded from listing and detail delivery.

Results order by the latest serving snapshot's publication timestamp descending, then article UUID descending. A new approved revision can therefore move an article into recent news while retaining its original ID and permalink. Pagination remains stable for an unchanged dataset, including equal timestamps. The existing PostgreSQL snapshot index on content/version supports the latest-publication lookup.

## Shared consumers and frontend states

`cms.selectors.posts.published_posts` owns eligibility, taxonomy filtering and ordering. The public list, detail and Post-backed widget sources reuse it. Taxonomy widgets include terms used by eligible articles. Public widgets retain their existing result limit and use the same publication summary serializer. `PublicPostFeed`, `postsFromResponse` and `postsPageFromResponse` provide the shared typed rendering contract for frontend consumers.

The news page shows loading placeholders, an intentional empty state, module unavailability and a recoverable error with retry and first-page recovery. Requests are cancelled when the active query changes, and former results are hidden immediately. Pagination URLs are constructed locally from validated query state. The frontend uses response pagination links as availability signals. Keyboard pagination restores focus to the News heading.

No new database migration is required. Existing article columns, snapshots, Media delivery and cache generations support the change. The clean-database regression applies the current migration graph. The compatibility checks retain public detail rendering and the shared widget payload.

[OpenAPI](api/openapi.yaml) and [news QA evidence](qa/public-news-2026-11-13/README.md)
