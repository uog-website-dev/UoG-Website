# Site-scoped Visual Builder workspace

The Pages list opens `/sites/{siteId}/admin/pages/{pageId}/builder` within the
existing Site Administration layout (the deployed URL has the `/admin` prefix).
An editor needs the active Site's PAGES module and `content.pages.update`.
Site Administration resolves Site identity and effective permissions on the
server; `SiteSection` and the workspace guard block disabled/read-only direct
navigation. A malformed UUID never starts a Page request. Backend CMS grants,
Site ownership, module gates and lifecycle remain authoritative on every read
and save; client permissions never replace them.

## Loading and context isolation

`GET visual-draft/` loads the existing Page revision, strong ETag and complete
tree. The workspace rejects a response for another Page or Site. It is keyed
by both IDs, so changes unmount the former canvas, selection, palette, inspector,
focus mode, undo/redo and errors before the next context renders. Pending loads
and saves ignore results after that context unmounts. There are explicit loading,
denial, retryable failure, empty, legacy-import and review-lock states.

Published Pages offer **Open working draft**, using the existing conditional
CMS working-draft service and navigating to its returned private Page ID.
Review/approved/archived Pages cannot edit through the canvas. An editable Page
with no layout offers a blank row or **Use sample starter**. Pointer drag and
keyboard ↑/↓ share the same composition helpers so both modes produce identical
order. **Add here** inserts between siblings; **Duplicate** clones a section with
fresh descendant IDs; invalid drops and occupied-column shrinks leave the tree
unchanged and announce the reason. The demonstration
has a 60/40 introduction and a Layout Slider containing a nested Headline; its
IDs are generated once and remain stable through edits and saves. It contains
no fabricated storage references or foreign asset IDs.

## Shell chrome, palette and editing

The workspace uses a three-pane shell: a top command bar, a left **Widgets /
Structure / Templates** dock, a center live canvas, and a right inspector.
The Templates tab lists Site-owned section presets; selecting a row in the
inspector offers **Save as template**. Insertion clones server-side with fresh
node IDs and media revalidation — see [section-templates.md](section-templates.md). The top bar keeps
Site and Page context, undo/redo, Desktop/Tablet/Mobile canvas viewport toggles
(shared with private preview), dirty/saved status, Preview, Save draft, CMS
workflow actions and focus mode. Focus mode hides the left and right docks while
keeping Page, Site and save controls visible; Escape returns to the full
workspace.

The left **Widgets** tab is the primary searchable catalog (43 types, seven
categories). Choosing a card inserts into the selected column (or the selected
widget's column, or a new row when empty). The **Structure** tab hosts the
nested outline. Precise **Add here** / nested layout-item insertion still opens
the card-picker dialog. That dialog identifies the active Site, Page, row,
column and optional layout item. Native buttons support Tab, Enter and Space;
arrow keys move between cards, Home/End select the ends, and Escape/cancel/success
restore the invoking control's focus. Search receives initial dialog focus, with
a clear-search action for empty results.

The dark row editor supports one to three columns and the approved ratios,
ordered row movement and column-local insertion. Reducing column count moves
the removed columns' widgets into the last retained column instead of dropping
content. The nested outline uses real buttons and stable node IDs. Canvas clicks
select the innermost widget and suppress navigation by its links while editing.
Selected nodes show selection chrome (type label plus move / duplicate / delete)
over the live canvas. Inspector controls use schema-backed properties and safe
presentation tokens; node and repeated-item IDs remain read-only. Layout item
insertion is restricted to the contract's Headline, Editor, Image and Button
leaves. Sections cannot be nested. The shared validator rejects stale insertion
contexts and bounded-tree violations before insertion or saving.

Images use the existing same-Site ready-image picker. New Image/Hero widgets
require a chosen ready asset. Slider/Gallery item editors use the same picker,
and saves revalidate media through the existing atomic backend service. Private
canvas image URLs use the authorized same-origin Site proxy. The live canvas
uses the existing shared admin/portal renderer, including its documented runtime
boundaries for catalog types; this shell does not introduce separate public
rendering engines or make unavailable dynamic providers functional.

## Saves, undo and focus

**Save draft** submits the whole validated tree with the loaded ETag, then
adopts the canonical returned tree/revision. Invalid drafts cannot save.
Backend field paths are displayed with errors, and a stale conflict retains
local changes without automatic merging or token replacement. A successful save
does not submit, approve, publish or modify public snapshots. Legacy blocks use
the compatibility adapter; an explicit visual save converts only the private
draft's active body and retains CMS revision history.

Undo/redo holds at most 50 local editing states (`layout` + selection) and never
calls CMS restore or publishing services. Section moves, duplication, column
resizes and repeater changes are single history steps; consecutive inspector
property edits on the same node coalesce briefly into one step. Discoverable
Undo/Redo controls and **Ctrl/Cmd+Z** / **Ctrl/Cmd+Y** (or Shift+Z) shortcuts
apply only when focus is outside text fields so native field editing is not
captured. A divergent edit after undo clears redo. Switching Site or Page (or
adopting a server draft) resets local history. Browser history remains separate
from this editor stack. Unsaved state is visible and registers a browser-unload
warning; editors should save before switching.

The CSS uses one stacked column on narrow screens and Widgets-Structure / canvas /
inspector columns at the large breakpoint. The canvas sits on a striped work
surface and constrains to the selected viewport width. Rows and picker cards
collapse on small screens, controls wrap, and long names/IDs can wrap. Browser
responsive visual verification is still pending; see the
[verification report](../qa/visual-builder-2026-11-12/report.md)
for the exact automation limitation and reproducible isolated browser fixture.

See also the [layout registry](visual-layout-contract.md),
[draft persistence/OpenAPI](visual-draft-persistence.md) and
[revision-bound publication](visual-publication.md).
