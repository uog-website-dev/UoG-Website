# Render host-scoped published news cards

The public news route now renders responsive cards with approved metadata, featured thumbnails and a consistent missing-image fallback. Pagination preserves the existing API shape, rejects invalid page sizes and exposes loading, empty, unavailable and retry states. Earlier requests are cancelled when filters or pages change.

The list, detail and Post-backed widget sources share publication eligibility and ordering. Latest snapshot timestamps determine recency, with a stable UUID tie-breaker. Future publications, drafts, working copies and unpublished records are excluded. Hostname resolution remains authoritative, and summaries omit private article bodies and review data.

No migration is required. API, card, widget and real-browser checks cover Site isolation, equal timestamps, pagination limits, media failure and recovery. Production build and exact QA results accompany the change. [QA evidence](README.md)

Independent approval and Azure DevOps Issue association remain pending.
