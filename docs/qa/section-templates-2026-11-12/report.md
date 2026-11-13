# Site-owned section templates — 2026-11-12

Site Editors can save validated visual sections and insert independent clones
into draft Pages. Templates are Site-scoped, versioned against layout schema
`1`, and never rewrite content that was already inserted after a later retire
or change.

Dependencies: P3-BUILDER-001–002, P3-FE-BUILDER-002–003.

## Contracts and implementation

- Architecture: [section-templates.md](../../architecture/section-templates.md)
- Model / service: `section_template_models.py`, `services/section_templates.py`
- API: `GET|POST /api/v1/sites/{site}/section-templates/`,
  `GET|PATCH …/section-templates/{id}/`,
  `POST …/pages/{id}/visual-draft/insert-template/`
- Builder UI: Templates dock + “Save as template” on a selected row

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Valid Site template inserts independently into multiple Pages | **PASS** | `test_save_and_insert_twice_yields_independent_copies` |
| Foreign templates fail without partial insertion | **PASS** | `test_foreign_template_insert_leaves_layout_unchanged` |
| Stale / unavailable required media fails clearly with no layout change | **PASS** | `test_retired_media_blocks_insert_without_partial_write` |
| Inserting a saved two-column Slider section twice yields independently editable copies; source template unchanged | **PASS** | Double insert + edit one caption; template caption preserved |
| Retire preserves already-inserted content and blocks new inserts | **PASS** | `test_retire_template_preserves_already_inserted_content` |

## Template version and media-reference compatibility

| Case | Result |
| --- | --- |
| Create with same-Site READY images | Accepted; `schema_version=1`, `version=1` |
| Insert remints section/column/widget/item IDs | Pass (`remap_section_ids` + insert twice) |
| Insert with ARCHIVED required media | 400 field errors; Page metadata/revision unchanged |
| Foreign Site template ID on another Site's Page | 400; Page unchanged |
| Non-current schema_version on insert | Rejected by service (`schema_version` error) |

## Results

| Suite | Result |
| --- | --- |
| `tests/test_section_templates.py` | 5 passed ([junit.xml](junit.xml)) |
