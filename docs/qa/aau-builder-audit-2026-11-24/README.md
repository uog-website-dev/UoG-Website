# AAU homepage rebuild in the Visual Builder — capability audit

Date: 2026-11-24 (Africa/Addis_Ababa). Reference: https://aau.edu.et/.
Site: **102 — AAU Builder Comparison** (`aau-review.localhost`, `aau-review.uog.local`).
This is a hands-on capability audit requested as "create the same homepage using our
visual builder … do not change any code". No source file was changed. No published
Page, homepage assignment or menu was changed.

## Result in one line

At audit time, the builder could create a Page and compose a **default-styled,
static approximation** of the AAU homepage, but it **could not open the existing
11-section AAU reconstruction** and **could not save any AAU-style section**,
because `validateVisualLayout` rejected every non-widget `oneOf` token union
(background, text colour, panel tone, curve border, heading colour). The
same-day fix and its verification are recorded below.

## Remediation and verification (same day)

The findings below describe the state before the fix. The `oneOf` branch in
`frontend/packages/types/src/layout/index.ts` now:

- treats a union as a widget union only when **every** branch has
  `properties.type.const` (matching `backend/apps/cms/layout_contract.py`);
- validates every other union with a bool-only `conforms` helper, so approved
  tokens and hex colours pass while `url(evil)` still fails.

Regression coverage added in `packages/ui/src/visual-layout.test.tsx`: approved
`background`/`text_color` tokens validate, unsafe values stay invalid, and
`aau-comparison.fixture.json` validates.

Verified against the running stack:

- The imported 11-row AAU Page (`180d0b82…`) now opens in the builder and saves
  (Revision 13). Row 8 keeps `background:"navy"`, `text_color:"inverse"`.
- Its preview renders with **one `h1`** (the first hero, set to heading level 1
  to satisfy the H1 contract), all sections, and the 4-slide hero.
- Homepage templates now show **Compatible** with Preview enabled for University
  Main, College/Department and Blank.
- `@uog/ui`: 292 tests pass. Admin builder/template/page suites: 58 tests pass
  (including the previously timing-out undo/redo test). Types, UI, admin and
  public typechecks pass.

### Token picker follow-up

`frontend/apps/admin-web/src/sites/visual-builder-inspector.tsx` now recognises
token-or-hex unions (an enum branch plus a `^#[0-9A-Fa-f]{6}$` branch) and renders
them as the same labelled swatch grid used for plain enums, plus a **native colour
picker** (`<Field> custom colour`) for the hex branch. Selecting a swatch stores the
token; picking a colour stores its `#rrggbb` value; choosing **Default** removes the
override. The picker opens at the current custom colour; when a token is selected it
starts from that token's swatch colour, or a default when the token is theme-relative.

Verified on the running builder, Row 8 of the imported AAU Page:

- **Background** renders 9 options and **Text color** 5, with Navy/Inverse pressed.
- Picking `#0a2540` in the native picker and saving produced Revision 16; the
  database stored `background:"#0a2540"` with `text_color:"inverse"`.
- Choosing **Navy** again saved Revision 17, restoring `background:"navy"`; the
  page still renders exactly one `h1`.
- Inspector test `offers swatches plus a native colour picker for token-or-hex style
  unions` asserts the control is `type="color"`, covers preset selection, a picked
  colour and clearing to Default. Admin typecheck and 40 inspector/builder/model
  tests pass.

### Renderer follow-up — picked colours now paint

`frontend/packages/ui/src/visual-presentation.tsx` previously mapped only the named
tokens and silently dropped `#rrggbb` values, so a picked colour was stored but never
rendered. It now:

- passes an approved `#rrggbb` through for section `background` and `text_color`, and
  for hero `panel_tone`, `curve_border` and `heading_color`;
- leaves the existing token mapping unchanged;
- chooses white or `#172536` text on a custom panel tone by relative luminance.

Verified live in the builder canvas on the Revision 17 draft, hero
`aau-hero_image-11`: panel tone `#0a2540` painted `rgb(10, 37, 64)`, curve border
`#00ff00` painted `rgb(0, 255, 0)`, heading colour `#ff0000` painted
`rgb(255, 0, 0)`, and body text stayed white. Row 8 background `#0a2540` also painted
`rgb(10, 37, 64)` with white text.

Re-opening the saved **Revision 16** preview (the revision that stored
`background:"#0a2540"`) now paints section `aau-section-95` as `rgb(10, 37, 64)` with
white text, so the stored value reaches the preview surface as well as the canvas.

Caveat: `layout_slider` renders only the active slide (`items[position]`). A hero on
another slide cannot show its colour change until that slide is shown, and
`autoplay_seconds` can advance the carousel while editing. Pause the carousel or
select the visible hero when checking colours. Selecting a hidden slide's hero from
the structure outline gives no canvas feedback; that is a builder usability gap, not a
persistence problem.

Two renderer cases were added in `packages/ui/src/visual-presentation.test.tsx`
(custom section/hero colours and light-panel contrast). `@uog/ui` typecheck passes and
the presentation/layout subset is 81 tests; the admin inspector/builder/model subset
is 40 tests.

## What was actually built

Draft Page `30552ce7-844d-43d8-80d0-a08458bec2d2`
("AAU Homepage — Builder Capability Audit", `/aau-homepage-builder-capability-audit`),
Revision 3, built entirely through the builder UI:

| Row | Widgets | Content |
| --- | --- | --- |
| 1 | Headline (h2), Editor, Button | "Seek Wisdom, Elevate Your Intellect and Serve Humanity", AAU introduction, "Visit the AAU website" → `https://aau.edu.et/` |
| 2 | Headline, Features (4 items), Button | "Our Impact in Numbers", Academic Excellence / Research and Innovation / Community Service / Global Partnerships, "View source statistics" |
| 3 | Headline, Loop Grid, Button | "What's New", live Site posts (card + 22 Nov 2026 date), "View more news" → `/news` |

Preview: `/admin/sites/102/admin/pages/30552ce7-844d-43d8-80d0-a08458bec2d2/preview`.
Rendered preview has **one `h1`** (the Page title) and the hero heading as `h2`; the
new zero/multiple-H1 gate and the title/hero heading contract behave as designed.

Not built, because of the blockers below or missing reference data: split-image hero
carousel, navy/mist full-bleed bands, quick-link grid, campus image grid, partner
carousel, announcements carousel, newsletter/search/chat.

## Blockers, in severity order

### 1. Validator rejects every style token (release-blocking)

`frontend/packages/types/src/layout/index.ts:47-49` treats **any** `oneOf` as a
widget union:

```ts
if (schema.oneOf) {
  const candidate = schema.oneOf.find(item => object && item.properties?.type?.const === object.type);
  if (!candidate) reject(`${path}.type`, "Unknown widget or nested Section. …");
  …
}
```

The generated schema also uses `oneOf` for token enums. Counted in
`layout-v1.schema.json`: **130 non-widget unions** — `background` ×59,
`text_color` ×59, `panel_tone` ×4, `curve_border` ×4, `heading_color` ×4.
None has `properties.type.const`, so all are rejected.

UI reproduction (no code change):

1. Open the audit Page, select Row 1, open **Presentation → Background**
   (a free-text input, not a token picker).
2. Type `navy`. Save becomes disabled with
   `metadata.visual_layout.rows[0].style.background.type: Unknown widget or nested Section. Use a registered leaf widget.`
3. The same value is valid against the schema and is what the imported AAU layout uses.

Consequences:

- The existing 11-row AAU reconstruction (`180d0b82…`, `2da503a8…`, archived copies)
  cannot be opened at all: **"This Page uses an unsupported or invalid layout. Its
  saved content has not been changed."**
- AAU's navy campus band, mist quick-link band and toned hero cannot be saved.
- The AAU comparison fixture `packages/types/src/layout/aau-comparison.fixture.json`
  fails the same validation.

### 2. Approved starting templates are disabled by the same defect

Builder → **Homepage templates** shows:

- University Main v4 — **Unavailable**, Preview disabled
- College/Department v4 — **Unavailable**, Preview disabled
- Blank v1 — Compatible

Availability is `validateVisualLayout(entry.layout).ok`
(`apps/admin-web/src/app/sites/homepage-template-actions.ts:20`), so the approved
templates are collateral damage of blocker 1. The Templates tab also reports
"No active section templates for this Site yet", so there is no reusable AAU section
to insert either.

### 3. Style controls are free text, not the approved tokens

> **Fixed** — see *Token picker follow-up* above. This section records the
> pre-fix behaviour.

Row/widget **Background** and **Text colour** are plain text inputs. The editor
accepts `navy` but neither offers the eight approved values nor prevents an invalid
entry; failure appears only at save time as a generic validator message. The
`oneOf` fix alone would leave this usability gap.

### 4. AAU sections that have no contract at all

- Full-bleed edge-to-edge bands: the Page setting exists ("Edge-to-edge bleed"), but
  band colours are blocked by blocker 1, so the AAU look is unreachable.
- Featured-news lead story + compact dated list: Loop Grid renders one uniform card
  grid (it does show the date in the builder preview).
- Partner directory / announcement carousel: no partner or announcement content type;
  only generic image/carousel widgets.
- Newsletter subscription, Site search and chat: not implemented in this CMS
  (unchanged from the 2026-11-22 audit).

## Capability matrix for the AAU homepage

| AAU area | Builder result |
| --- | --- |
| Page shell, draft save, revision, preview | Works (Revision 3 saved; preview renders) |
| Hero heading, paragraph, CTA | Works as static default-styled content |
| Split-image hero carousel with tone/curve | Blocked: `panel_tone`/`curve_border`/`background` unions rejected |
| Impact statistics cards | Works as Headline + Features + Button (no metric/source contract) |
| Navy / mist full-bleed bands | Blocked by validator; page bleed setting alone is insufficient |
| Quick links | Button Grid widget available, not exercised end-to-end |
| Campus image grid | Image Grid widget available, needs Site media binding |
| Latest news | Works: Loop Grid rendered a real Site post with date |
| Partner / announcement carousels | Widgets exist; no partner/announcement content source |
| Newsletter / search / chat | Not implemented |

## Reproduction summary

1. Create a Page on Site 102 and open its builder — succeeds.
2. "Use sample starter", edit Headline/Editor/Button, add Headline + Features (4
   items) + Button, add Headline + Loop Grid + Button — all succeed and save.
3. Set Page title hidden with no H1 widget — save blocked with
   "The Page title is hidden, so one widget must be the H1…" (expected behaviour).
4. Set Row Background to `navy` — save blocked with the token-union error.
5. Open `180d0b82-420d-4d86-838d-d6fb33423029` in the builder — "unsupported or
   invalid layout".
6. Open Homepage templates — University Main and College/Department unavailable.

## Evidence

- Builder palette for this Site: **40 widgets match**.
- Saved draft: 3 rows; widgets `headline` ×3, `editor` ×1, `button` ×3,
  `features` ×1, `loop_grid` ×1.
- Preview DOM: 1 `h1` (Page title), `h2` hero/impact/news headings.
- Backend log for the earlier audit page after it was removed: `PATCH
  /api/v1/sites/102/pages/<id>/visual-draft/ 404`. The page disappeared mid-session;
  the cause was not established, so it is recorded as an observation, not a defect.

## Recommendation

Both fixes above are applied: the validator accepts value unions, and Background /
Text colour are token pickers with an optional native colour picker. Next: re-run
this audit against the 11-row reference layout (now Revision 17) and record any
remaining presentation gaps.

Prior deep capability findings remain in
[aau-builder-audit-2026-11-22](../aau-builder-audit-2026-11-22/README.md) and
[aau-comparison-2026-11-22](../aau-comparison-2026-11-22/README.md).
