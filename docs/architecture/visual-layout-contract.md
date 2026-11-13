# Visual layout contract v1

The product-provided 43-widget palette is defined in the [registry schema](../../backend/apps/cms/schemas/layout/layout-v1.schema.json).
[Shared examples](../../backend/apps/cms/schemas/layout/fixtures.json) contain a
valid configuration for every widget, a three-column Image Slider layout and
rejected documents. `scripts/generate_layout_contract.py` is the source for
the registry schema, shared fixtures and discriminated TypeScript props.
`python scripts/generate_layout_contract.py --check` runs in Azure CI and
rejects backend/frontend artifact drift, including the frozen migration schema.

## Envelope and persistence

Pages may opt in using `metadata.visual_layout`:

```json
{
  "schema_version": 1,
  "rows": [{
    "id": "intro", "type": "section", "ratios": [60, 40],
    "columns": [
      {"id": "intro-main", "type": "column", "children": [
        {"id": "welcome", "type": "headline", "props": {"text": "Welcome to Gondar", "level": 2}}
      ]},
      {"id": "intro-side", "type": "column", "children": [
        {"id": "apply", "type": "button", "props": {"label": "Apply", "href": "/admissions"}}
      ]}
    ]
  }]
}
```

The existing Page `layout` template hint and `blocks_version` remain separate.
The visual envelope is stored in the existing metadata JSON, so working drafts,
revisions, restoration and publication snapshots retain the complete contract
without adding another mutable document. Normal Page authorization, optimistic
concurrency and review/publication locks apply. Other content types cannot opt
in. New visual Pages should use `blocks: []`. Reads and migrations never silently convert or remove existing blocks. An explicit complete-body visual draft save replaces the active flat body while preserving it in immutable history; see [draft persistence](visual-draft-persistence.md).

Array position defines order; there is no conflicting numeric order property.
Every section, column and widget has a required document-unique stable ID:
1–128 ASCII letters/digits/dot/underscore/colon/hyphen, starting alphanumerically.
Moves preserve IDs. Clones receive new IDs before saving. Repeated items have
stable IDs unique within their parent widget.

## Structure and bounds

- Up to 50 top-level sections, each containing one to three columns.
- Approved v1 relative column weights: `[100]`, `[50,50]`, `[60,40]`, `[40,60]`,
  `[70,30]`, `[30,70]`, `[75,25]`, `[25,75]`, `[1,1,1]`. Weights and column
  counts must match. Three columns share equal width. Without overrides,
  columns stack below the historical 900px container threshold and keep their
  original order.

## Responsive breakpoint overrides

Desktop is the base surface (`style`). Approved override tokens are `tablet`
and `mobile` only. Preview widths stay `desktop=1280`, `tablet=768`,
`mobile=390`, with resolve ranges mobile ≤767, tablet 768–1279, desktop ≥1280.

| Surface | Allowed override properties | Reset |
| --- | --- | --- |
| Section | `stack` (boolean), `gap` (`none\|sm\|md\|lg`) | Delete the key to inherit |
| Widget | `gap` only | Delete the key to inherit |

Precedence at a width: start from desktop `style`, apply `tablet` when the
active token is tablet or mobile, then apply `mobile` when the active token is
mobile. Editor canvas/private preview and public output share
`resolveSectionPresentation` / `resolveWidgetPresentation`. Unknown breakpoint
tokens or properties fail validation. Older layouts without `responsive` keep
default rendering. Migration `cms.0019_responsive_layout_overrides` refreshes
the database shape guard for the additive fields.
- Columns accept up to 50 registered leaf widgets. A Section cannot appear
  inside a column, widget or repeated item.
- Layout Slider, Anything Carousel and Simple Masonry accept up to 50 content
  items. Each item contains up to 20 Headline, Editor, Image or Button nodes;
  these cannot contain another layout, carousel or Section. Structural node
  depth is therefore at most four: section → column → widget → content leaf.
- At most 200 structural nodes across the complete document, including content
  leaves. Repeater IDs do not count as structural nodes, but item arrays remain
  bounded. Images and links have at most 50 items; feeds have limits 1–20.
- Maximum compact UTF-8 JSON payload: 262,144 bytes. Text properties have
  explicit limits (400-character labels/headlines, 20,000-character rich/plain
  bodies, 255-character image alt text). Unknown properties are rejected at
  every schema object boundary.

`validateVisualLayout` in `@uog/types` is used by Admin authoring and the shared
portal renderer. Backend validation returns field paths such as
`metadata.visual_layout.rows[0].columns[1].children[0].props.items` and never
mutates caller input. Migration `cms.0014_visual_layout_contract` installs the
frozen schema and document-wide identity/size/count guards for raw SQL and
bulk writes as well. The database is a backstop; API/domain errors carry the
detailed field paths.

## Typed properties and safety

`WidgetPropsMap` and `WidgetNode` are generated discriminated unions. Each of
the 43 names accepts only its declared properties; no arbitrary HTML component,
CSS, event handler, JavaScript, object path or executable expression is accepted.

Style tokens are `align: start|center|end`, `tone: default|muted|brand` and
`gap: none|sm|md|lg`; the renderer maps them to controlled theme values. Links
must be root-relative paths (not `//host`) or HTTP(S)/mailto destinations without
whitespace/backslashes. Editor HTML uses the existing backend allowlist sanitizer
and existing safe paragraph renderer. Frontends never mount raw HTML.

Images use canonical asset UUIDs. Same-Site ready-image checks run before Page
writes, including images nested in content slides. Draft/publication inventories
use node ID plus `props.asset_id` or `props.items.asset_id` and repeated item ID.
Publication references remain protected after removal from a draft. Existing
reference serialization, delete locks and private/public media delivery apply.

Video Player accepts a provider enum and video ID; Google Maps accepts bounded
coordinates and zoom. These render safe destination links in this contract
increment. Lottie, contact forms, menus and dynamic feeds accept named sources
or codes, never arbitrary endpoints or embedded scripts.

## Registry and runtime boundary

The schema defines the exact product list:

| Group | Widgets |
| --- | --- |
| Media & Sliders (9) | Hero Image, Image Slider, Image Grid, Layout Slider, Simple Masonry, Anything Carousel, Lottie Player, Video Player, Image |
| Interactive (6) | Button, Button Grid, Contact Form, Tabs, Accordion, Call To Action |
| Content (8) | Headline, Editor, Blog, Recent Posts, Post Carousel, Testimonials, Author Box, Features |
| Information (5) | Taxonomy, Icon, Price Table, Google Maps, Social Media Buttons |
| Site Identity & Navigation (5) | Site Logo, Site Title, Page Title, Menu, Breadcrumbs |
| Dynamic Content (6) | Loop Grid, Loop Carousel, Taxonomy Filter, Post Title, Post Excerpt, Featured Image |
| Page Utilities (4) | Alert, Table of Contents, Menu Anchor, Countdown |

This increment defines and validates configuration for all 43 widgets. It does
not claim all 43 production widget runtimes are implemented. Shared rendering
covers ordered sections/columns, text, media, safe links, static cards and
primitive informational content. Image Slider uses the existing navigation.
Tabs/Accordion currently use accessible disclosure content; custom content
slides/carousels/masonry render their ordered content without animated layout.
Countdown displays its target time. Dynamic sources, animation assets, form
submission, Site/Post identity bindings (except Page Title), menus, breadcrumbs
and generated table-of-contents integration need their respective runtime
stories. Missing bindings show a controlled unavailable state. Registry membership
alone is not a claim that those services are shipped.

Both frontend consumers use the same generated types and shared renderer; the
fixture suite exercises that technical compatibility. Product supplied the
widget list; no separate human frontend design sign-off is asserted here.

## Version and backward-compatibility matrix

| Stored Page | Write policy | Read policy |
| --- | --- | --- |
| No visual payload; blocks v1 or empty | Existing v1 rules | Existing legacy renderer, including empty-body Pages |
| Visual schema 1 | Strict schema + IDs/counts/size + scoped media checks | Shared visual renderer, original array order |
| Visual schema unknown, malformed or null | Reject without changing the Page | Controlled unavailable state; do not reinterpret as v1 or expose stale legacy content |
| Legacy flat import | Explicit `adaptLegacyBlocks`; validate before save | Deterministic one-column rows; preserve existing node IDs |
| Legacy path-based images during import | Require an explicit canonical Media asset mapping | Legacy Page remains readable through its existing renderer |

The compatibility adapter preserves the source payload and returns stable IDs
for repeat imports of unchanged idless input. Persist those IDs once; do not
regenerate them during reorder. Legacy sections flatten in semantic order.
No migration rewrites published Pages or historical snapshots. Future breaking
schema changes get a new version, validator, fixtures and explicit migration;
v1 artifacts and the frozen migration schema are not changed in place.

See [verification evidence](../qa/visual-layout-2026-11-12/report.md).
