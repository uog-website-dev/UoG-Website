# Structured content blocks (P2-CMS-003)

Blocks are the one structured-content format of the platform: an ordered
JSON list stored on the shared `SiteContent` record (`cms.blocks`), so
**Pages and Posts reuse the same schema, the same validators and the same
safe-rendering contract** — there is no per-type block dialect. Domain
validation lives in `backend/apps/cms/blocks.py`; the database backstop
(`cms_validate_blocks` trigger on `cms_sitecontent`) repeats the structural
envelope for writers that bypass the domain.

The machine-readable Draft 2020-12 schema for version 1 is
[blocks-v1.schema.json](../../backend/apps/cms/schemas/blocks-v1.schema.json).
It defines every supported block shape and the collection/count limits.
Application validation additionally enforces serialized byte limits,
sanitization and Site-specific reference ownership.

## Schema versioning

| Field | Contract |
| --- | --- |
| `blocks_version` | The schema version the payload was written with, stored per record. Currently `"1"`. A version not in the supported registry is rejected at write time (`content_blocks_version` check and domain check); future schema versions add validators there and migrate stored payloads. Server-managed — callers never set it. |

## The `"1"` block schema

Every block is a JSON **object** with a required string `type` plus the
fields of that type. Structurally: at most **100** blocks per record,
every block at most **12288** bytes serialized, the whole list at most
**262144** bytes serialized (defaults `MAX_BLOCKS`, `MAX_BLOCK_BYTES`,
`MAX_BLOCKS_BYTES`). Blocks are never `null`.

### `"heading"`

```json
{"type": "heading", "level": 2, "text": "Academic calendar adjusted"}
```

- `level`: `2`, `3` or `4` — the page title is the document's `h1`; block
  headings must not claim it.
- `text`: plain text, 1–400 characters. **Not HTML** — renderers must emit
  it as character data, never as markup.

### `"paragraph"`

```json
{"type": "paragraph", "html": "<p>Hello <strong>world</strong>.</p>"}
```

- `html`: the one HTML-bearing field, 1–20000 characters, **sanitized on
  write with nh3** (ammonia): only `a`, `p`, `br`, `strong`, `b`, `em`, `i`,
  `u`, `s`, `ul`, `ol`, `li` survive; anchors keep `href` and `title` only,
  restricted to `http`/`https`/`mailto` URLs and site-internal paths, and
  every anchor gains `rel="noopener noreferrer"`. `script`/`style`
  elements are removed *with their contents*, unknown tags are unwrapped
  to their text, and event-handler attributes (e.g. `onerror`, `onclick`)
  cannot survive — so a stored payload cannot render, or later smuggle,
  an executable script. A fragment that is empty after sanitization is
  rejected.

### `"image"`

```json
{"type": "image", "ref": "shared/logos/seal.png", "alt": "Official seal",
 "caption": "University of Gondar"}
```

- `ref`: a scope-checked storage reference — **never an URL**. Grammar:
  `sites/<site-id>/<segment>[/<segment>…]` (the Site's own scope, and the
  id must equal the content's owning Site) or
  `shared/<segment>[/<segment>…]` (assets shared platform-wide).
  Lowercase segments of letters, digits, dots, underscores, hyphens; no
  backslashes, no `..` traversal, no empty or doubled path segments,
  at most 512 characters. A reference into *another* Site's scope is
  rejected, so content cannot address another Site's namespace. The
  current CMS boundary has no media registry or upload API; it authorizes
  the namespace (shared or owning Site) but cannot prove that the referenced
  object exists. The planned MEDIA capability must provide object-level
  authorization and existence checks before any content-serving endpoint
  resolves these references.
- `alt`: required honest alternative text, 1–255 characters, plain text.
- `caption`: optional, 1–400 characters, plain text.

### `"button"`

```json
{"type": "button", "label": "Apply online", "href": "/admission",
 "new_tab": false}
```

- `label`: plain text, 1–200 characters.
- `href`: a root-absolute site path (`/about`, `/about#team`) or an
  `http(s)`/`mailto` URL with a host. Protocol-relative `//host`,
  `javascript:`, `data:` URLs, whitespace or control characters are
  rejected, at most 2000 characters.
- `new_tab`: optional boolean, default `false`.

### `"list"`

```json
{"type": "list", "style": "ordered", "items": ["Register", "Attend", "Pass"]}
```

- `style`: `ordered` or `unordered`.
- `items`: 1–50 plain-text strings, each 1–1200 characters. **Not HTML.**

### `"section"` (optional container)

```json
{"type": "section", "heading": "Highlights",
 "children": [{"type": "paragraph", "html": "<p>…</p>"}]}
```

- `heading`: optional, 1–400 characters, plain text.
- `children`: 1–100 **non-container** blocks of the types above (sections
  cannot nest sections), so nesting depth is structurally bounded to two
  levels without a depth search.

## Validation errors are field-level

Rejected fields raise `ValidationError` entries keyed by their JSON path —
for example `blocks[0].level`, `blocks[2].ref`, or
`blocks[3].children[1].html` inside a section — so an API client can point
editors at the exact offending input. Unknown block types and non-object
entries are reported at the block path; unknown and missing payload fields,
wrong value shapes and oversized fields are reported at the field path.
Serializers run the same validator before save and return these paths as
field-level API errors.

## Rendering contract (downstream layers)

- `paragraph.html` is **already safe storage**: renderers may inject it
  directly; they must not add HTML of their own from unvalidated inputs.
- Every other string field is character data: renderers escape it. The
  storage format deliberately keeps plain text unescaped so renders choose
  their own escaping on demand.
- Block order **is data**: the array position persists, survives reloads,
  and is returned as-is — no re-ordering field, no implicit sort.
- Rendering rules for `public-web` will consume the same payload; a
  drag-and-drop visual builder is explicitly out of scope for this story.

## Database backstop (`cms_validate_blocks`)

A `BEFORE INSERT OR UPDATE` trigger on `cms_sitecontent` rejects, for any
writer (ORM, raw SQL, future import tools):

- a `blocks` value that is not a JSON array (`content_blocks_array`),
- any element that is not an object, lacks `type`, or whose `type` is not
  one of the six registered strings (`content_blocks_element_type`),
- any element above 12288 serialized bytes (`content_blocks_item_size`),
- more than 100 top-level blocks (`content_blocks_count`),
- a list above 262144 serialized bytes (`content_blocks_total_size`).

The version check itself remains a declarative constraint
(`content_blocks_version`: value in the supported registry), which future
migrations extend.

The legacy platform-wide `apps.api.Page` model and `/api/pages/` endpoints
are untouched, no content endpoint ships in this story and the OpenAPI
snapshot is therefore unchanged.
