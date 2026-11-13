# Site-owned visual section templates

Site Editors save reusable layout sections and insert clones into draft Pages.
Templates are CMS resources scoped to one Site. They are not platform
`SiteTemplate` provisioning records.

## Lifecycle and scope

| State | Behavior |
| --- | --- |
| ACTIVE | Listed and insertable for the owning Site |
| RETIRED | Hidden from the default list; new inserts rejected; Pages that already inserted a clone keep their content |

Each template stores:

- `name`, `status`, `schema_version` (must equal the current layout contract version, presently `1`)
- `version` (template revision counter for the saved preset)
- `section` — exactly one validated `LayoutSection`, including nested widgets and repeater order

Create and update revalidate the section against the layout schema and
re-check every media reference with `validate_layout_media` for that Site.
Foreign Site assets cannot be saved into a template.

When the layout schema version advances, templates whose `schema_version` is
no longer current cannot be inserted. Editors must save a new template from a
valid section. Already-inserted Page content is never rewritten by template
retirements or schema changes.

## Permissions and modules

| Action | Gate |
| --- | --- |
| List / retrieve | CMS AUTHOR, REVIEWER or PUBLISHER + PAGES + VISUAL_BUILDER |
| Create / rename / retire | CMS AUTHOR + PAGES + VISUAL_BUILDER |
| Insert into a Page draft | CMS AUTHOR + PAGES + VISUAL_BUILDER + Page `If-Match` |

## Insertion

`POST /api/v1/sites/{site}/pages/{page}/visual-draft/insert-template/`

1. Resolve the template on the same Site only (foreign IDs fail closed)
2. Reject RETIRED templates and non-current `schema_version`
3. Deep-clone the section and mint new node/item IDs
4. Append to the Page's visual layout and run `save_visual_draft`
5. Schema or media failure rolls back with no partial insertion

The source template and sibling insertions remain unchanged when one inserted
copy is edited later.

## API surface

- `GET|POST /api/v1/sites/{site_pk}/section-templates/`
- `GET|PATCH /api/v1/sites/{site_pk}/section-templates/{id}/`
- `POST /api/v1/sites/{site_pk}/pages/{id}/visual-draft/insert-template/`

See also [visual-layout-contract.md](visual-layout-contract.md) and
[visual-draft-persistence.md](visual-draft-persistence.md).
