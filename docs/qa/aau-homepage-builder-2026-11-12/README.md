# AAU homepage Builder exercise

Reference inspected in the user's Chrome window on 12 November 2026 at https://aau.edu.et/.

Created [Informatics Home — AAU Reference](http://localhost/admin/sites/16/admin/pages/f0d5599a-a7ed-4e75-95fc-6f8173001df7/builder) in Site 16, College of Informatics. The Page remains a private draft at revision 3. Homepage assignment and publication were outside this exercise.

## Result

The draft contains 15 ordered sections and 53 widgets. It follows the reference's navigation, split-image hero, image slider, impact cards, quick links, campus life, learning facilities, research, news, campus feature, collaboration, contact and footer structure. Copy was adapted to Informatics without adding unverified institutional statistics. The four imported photographs depict AAU and are labelled as reference media in the Informatics library.

Page creation was exercised through the Pages UI. The initial complete tree was assembled through the existing guarded draft service with actor `devuser`, normal module/permission checks, schema validation, media validation, optimistic revision checking and transactional reference inventory. A subsequent headline edit and save were exercised through the actual Builder inspector. This creates a reproducible populated draft while recording which steps were performed in the browser.

## Observed checks

| Check | Actual outcome |
| --- | --- |
| Create Page in active Informatics Site | New Site-owned draft created through Pages |
| Import reference media | Four images accepted and processed to READY by Celery |
| Oversized image rejection | Two reference images exceed the configured 40 million pixel limit and were excluded |
| Save complete tree | Validated 15-section, 53-widget tree saved at revision 2 |
| Desktop preview width | Found unintended column stacking in a narrow editor workspace and fixed it |
| Mobile canvas | Observed centered 390px surface with stacked columns |
| Outline and inspector | Selected the hero Headline through Structure and edited its Text field |
| Save from Builder UI | Persisted “Explore ideas. Shape the digital future.” at revision 3 |
| Private preview | Opened saved revision 3 and inspected the mobile layout |
| Image Slider | Clicked Next slide and observed image, caption and counter change from 1 of 4 to 2 of 4 |
| Contact Form | Preview displays disabled submission controls according to its publication contract |
| TypeScript | Passed with incremental cache disabled during the dev-server restart |
| Builder and inspector tests | 22 passed, including the new device-width regression |

[Saved tree](saved-layout.json), [initial tree](initial-layout.json), [test results](builder-tests.xml), [TypeScript output](typecheck.log).

## Preview correction

The editor previously constrained a 1280px Desktop canvas to the available workspace width. This activated narrow-layout container queries even with Desktop selected. The canvas and private preview now preserve the selected CSS layout width and use a measured zoom to fit their workspace. ResizeObserver updates the fit on pane changes. Selection outline measurements account for that zoom. Mobile retains its 390px layout width.

## Gaps preventing an exact visual match

- The current contract offers alignment, spacing and three background tones. It lacks AAU's custom background artwork, curved image masks, image/text overlays, explicit hero height and detailed image-crop controls.
- Heading sizes and button appearance follow the shared renderer. Per-widget typography, colors, borders and button variants are absent. The automatic Page title also appears above the authored tree.
- Image Slider supports image/caption navigation. The AAU hero combines imagery, styled text and multiple calls to action in each slide. Layout Slider and Anything Carousel currently render their item content as static stacks.
- Menu remains an integration fallback. This exercise uses Button Grid for the navigation and footer links. AAU's dropdown navigation needs a working Menu binding and presentation options.
- The link validator rejects bare fragment destinations. Draft links use the Page path followed by the fragment. Private-preview anchor navigation was not accepted as verified behavior.
- AAU's newsletter, chatbot, announcement overlay and partner carousel have no equivalent fully configured provider path in this draft. The news widget uses the active Site's published Posts, and its content depends on that catalog.

The draft demonstrates existing Builder functionality and the remaining fidelity limits. Exact AAU visual equivalence and a published Informatics root remain pending.
