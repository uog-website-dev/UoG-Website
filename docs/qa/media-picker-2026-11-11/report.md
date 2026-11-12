# Site media asset picker — 2026-11-11

Content Editors can select an existing eligible Site asset through a shared
modal picker and reuse it across CMS Page editing and Visual Builder image
fields (standalone Image plus per-item Slider/Gallery).

## Contracts and implementation

- Shared picker: [media-picker.tsx](../../../frontend/apps/admin-web/src/sites/media-picker.tsx)
- Image selection field: [site-image-field.tsx](../../../frontend/apps/admin-web/src/sites/site-image-field.tsx)
- Visual Builder / repeater surface: [content-media-builder.tsx](../../../frontend/apps/admin-web/src/sites/content-media-builder.tsx)
- CMS consumer: [site-pages.tsx](../../../frontend/apps/admin-web/src/sites/site-pages.tsx) (`Choose uploaded image`, Image/Slider/Gallery editors)
- Ready-image list + confirm eligibility: library `ready_images` + `getSiteMedia` re-check on confirm; backend `check_image_ref` on save
- Architecture: [media-uploads.md](../../architecture/media-uploads.md), [cms-content-blocks.md](../../architecture/cms-content-blocks.md)

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Picker works in CMS and Visual Builder; returns only ready same-Site asset of required type | **PASS** | CMS `MediaPickerDialog` + `MediaBlockEditor`; confirm calls `getSiteMedia` / `isEligibleReadyImage` |
| Escape cancels without change and returns focus to invoking control | **PASS** | `Escape cancels without change and returns focus…` in [picker.xml](picker.xml) |
| Changing a Slider slide leaves other slides unchanged; focus returns to invocation | **PASS** | `changes only the targeted Slider slide and restores focus after picking` |

## Test coverage

| Case | Result | Evidence |
| --- | --- | --- |
| Component: keyboard filter, select, cancel; focus + payload | **PASS** | [picker.xml](picker.xml) |
| Integration: picked asset ineligible before save; error + draft retained | **PASS** | `keeps the draft image selection when save finds the asset ineligible` |
| Advanced: two slides, reorder, reopen picker; refs follow entries | **PASS** | `keeps separate slide references after reorder and reopen` |
| Backend eligibility on save | **PASS** | [backend-eligibility.xml](backend-eligibility.xml) (`test_upload_processing_worker_and_ready_picker_have_one_identity`) |
| Page editor regression | **PASS** | 20 SitePagesPanel tests in [picker.xml](picker.xml) |

## Dialog accessibility / consumer links

- Dialog labelled `Choose a ready image`; Cancel and Escape close without applying.
- Invoking controls use `aria-haspopup="dialog"`; focus restored via `returnFocusRef`.
- Alt text fields expose accessible labels (`Image alt text`, `Slide N image alt text`) with guidance helper text.
- Consumers: CMS Page editor (`site-pages.tsx`) and Visual Builder media fields (`MediaBlockEditor` / `RepeaterMediaEditor`).

## Results

| Verification | Result |
| --- | --- |
| Picker + save integration + Page regression | 27 passed ([picker.xml](picker.xml)) |
| Backend ready-picker identity | 1 passed ([backend-eligibility.xml](backend-eligibility.xml)) |

Full Keycloak→Admin browser E2E against a live worker remains unavailable in this
checkout and is waived consistent with adjacent media packs; component and API
layers cover the named story paths.
