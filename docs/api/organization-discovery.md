# Organization search and filtering

Discovery applies to **GET `/api/v1/organizations/` only**. Authentication
and permissions are unchanged: a verified Keycloak `platform-admin` bearer
token is required. Filters only narrow the view's authorized queryset; they
never grant access to an organization. No development write opt-in is
required for reads. See the [base API contract](organizations.md) and
[hierarchy navigation](organization-hierarchy.md).

```text
/api/v1/organizations/?search=informatics&type=COLLEGE&status=ACTIVE&ordering=name
/api/v1/organizations/?parent=42&status=ACTIVE&page=2
/api/v1/organizations/?parent=null
/api/v1/organizations/?code=CI
```

| Parameter | Behavior |
| --- | --- |
| `search` | Trimmed, case-insensitive literal substring of **name OR code**; maximum 255 characters. An empty/whitespace-only search applies no search predicate. |
| `name` | Trimmed, case-insensitive literal name substring; maximum 255 characters, nonblank. |
| `code` | Exact normalized code: trimmed and uppercased, maximum 64 ASCII characters, with the same letter/digit/underscore/hyphen format as creation. Partial code matches use `search`. |
| `type` | Exact, case-sensitive code of an existing managed OrganizationType, e.g. `COLLEGE`. Configurable lookup types work too; unknown/malformed codes return 400. |
| `status` | Exact `ACTIVE`, `INACTIVE` or `ARCHIVED`; omission includes all lifecycle states. |
| `parent` | Direct parent positive bigint ID (1–9223372036854775807), or lowercase literal `null` for root units. Does not include deeper descendants. Valid absent/invisible parent IDs return an empty list without revealing existence. |
| `ordering` | Comma-separated `code`, `name`, `created_at`, `updated_at`; prefix each field with `-` for descending. Default `code`. No repeated fields; at most four. If code is absent, ascending unique code is appended as a deterministic tie-breaker. |
| `page` | Existing page-number pagination, fixed at 20 rows per page. Invalid/out-of-range pages retain the existing 404 contract. |

All predicates combine with **AND**, including `search`'s inner name/code
OR. For example `search=informatics&type=COLLEGE&status=ACTIVE` matches
active colleges whose name or code contains “informatics”. `%`, `_` and SQL
fragments in text search are treated as literal text, not SQL wildcards or
expressions. Search is a substring operation, not tokenized full-text search.
Name ordering uses the database's configured collation; it is not a custom
locale-specific or case-insensitive ordering.

Unknown query parameters, repeated keys (including `page`), blank filters
other than search, malformed/unknown type or status values, invalid parent
IDs, and unsupported ordering return **400 validation_error** with field
errors in `error.details` and the matching `X-Request-ID`. Explicit empty
filters are never silently discarded. Authorization runs before validation.
Only whitelisted ORM fields can be used for ordering: relations, metadata
paths and arbitrary expressions are rejected. These list validation rules
replace the earlier list behavior of ignoring unsupported query parameters.

Success retains `{count,next,previous,results}` and the existing explicit
Organization fields. `count` describes the filtered total; page links
preserve search/filter/ordering parameters. No results is 200 with count 0
and an empty results array. Responses remain `private, no-store`.
Stable ordering prevents ambiguous ties across pages, but concurrent writes
can still shift offset-based pages; no snapshot paging is claimed.

List parameters do not filter detail, mutation or hierarchy endpoints.
Hierarchy operations keep their documented structural ordering and lifecycle
inclusion. This separation prevents a search predicate from accidentally
changing cycle validation, ancestry or the visible tree's structural links.
For large direct-child sets that exceed the hierarchy response limit, use
the paginated list with `?parent={id}`.

## Query behavior and performance

Predicates, ordering, count and page slicing execute in PostgreSQL. The list
hydrates at most 20 units per page, joining organization types rather than
loading a type per row. Exact code uses the existing unique index; parent
and type have FK indexes; status/code has its existing measured composite
index. Substring search can scan records, and name/date ordering can sort.
No new index, migration, search service or OpenSearch dependency is added.

Reproduce the local benchmark with:

```console
docker compose exec -T backend python scripts/benchmark_organization_discovery.py
```

The script uses a session-local temporary copy with the real table's current
CHECK constraints/indexes and 10,000 synthetic units. It never writes persistent
unit rows or advances their sequence. Each case executes the actual ORM
count plus a 20-row page five times, with joined type hydration; the late-page
case uses offset 1,000. It prints median elapsed times and EXPLAIN ANALYZE
plan summaries. Local warm-cache measurements on 2026-10-23, while tests were
also running:

| Case | Matching rows | Median count + page | Page SQL execution |
| --- | ---: | ---: | ---: |
| Exact normalized code | 1 | 5.956 ms | 0.392 ms |
| Name/code substring | 1,000 | 33.335 ms | 12.636 ms |
| Search + type + parent + status, ordered by name/code | 260 | 13.014 ms | 2.224 ms |
| Active units, name/code ordering, offset 1,000 | 7,792 | 30.806 ms | 15.328 ms |

These are query-path measurements on synthetic temporary data, not HTTP
latency or a production SLA. Exact code used an index scan; the combined
case used the type FK index. Unrestricted substring/name ordering scanned
and sorted at this scale. The observed costs support retaining current
indexes for expected institutional scale. Re-measure on realistic production
cardinality before adding expression/trigram indexes or changing pagination.

## Schema and completion evidence

The seven discovery parameters and validation responses are documented in
the [OpenAPI snapshot](openapi.yaml) and live `/api/schema/`/`/api/docs/`.
Existing Azure CI validates the schema, checks snapshot equality and
publishes the `openapi-schema` artifact.

API tests in `backend/tests/test_organization_discovery_api.py` cover name/
code search, literal escaping and Unicode, individual and combined filters,
configurable types, invalid/blank/repeated parameters, approved ordering,
tie-breaking across filtered pages, SQL pagination, bounded query counts,
authorization, and separation from hierarchy/detail behavior.

No new migration is required; organization migrations through
`0005_lifecycle_rules` remain the database reference. A merged PR/commit and
hosted CI result must be attached after push/review; local validation does
not establish those external results.

### Local verification (2026-10-23)

- Complete PostgreSQL-backed Docker suite: **293 passed in 83.44s**
  (`pytest -o addopts='' -q`). This includes 63 discovery cases and all
  earlier organization, hierarchy, lifecycle, authentication and docs tests.
- `manage.py check`, `makemigrations --check --dry-run` and
  `migrate --check`: exit 0. No new or pending migration.
- `spectacular --validate --fail-on-warn` with CI's `DEBUG=False`: exit 0.
  The committed schema documents all seven discovery parameters plus page,
  including 400 query validation and existing 404 pagination errors. The
  generated schema matches the repository snapshot.
- The 10,000-row temporary-data benchmark completed successfully; measurements
  and limitations are recorded above. No persistent organization data changed.
- Docker services remain running and healthy where health checks exist.
  Health, Swagger and schema return 200 through Nginx; an anonymous combined
  search/type/status request returns 401.
- No regression detected locally. Merged PR/commit and hosted CI result
  remain pending; no remote merge or pipeline success is claimed.
