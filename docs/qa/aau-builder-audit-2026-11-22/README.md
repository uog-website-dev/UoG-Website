# AAU homepage comparison and Visual Builder audit

Date: 2026-11-22. Reference: https://aau.edu.et/. Repository HEAD: cc7d4db, with the current uncommitted shared Footer implementation included. This is the audit option requested by the user; it does not apply a new homepage or publish changes.

**Result: the CMS can compose an approximation, but the approved starting templates and widget runtime do not yet support the complete reference experience. Do not describe the 43-widget catalogue as 43 fully implemented widgets.**

Reference inspection used a real Edge browser at 1440 px, a full-page screenshot and DOM inventory. Local verification covers Main, Informatics and Agriculture at 390, 768 and 1440 px. Reference observation is presentation/interaction inventory; newsletter delivery, chat service quality and other third-party backends were not exercised.

## Findings ordered by implementation priority

| ID | Priority | Finding and evidence | Required outcome |
| --- | --- | --- | --- |
| AAU-01 | High, functionality | Eight registered widgets have no explicit render handler: lottie_player, blog, recent_posts, post_carousel, taxonomy, breadcrumbs, loop_carousel and table_of_contents. `visual-layout.tsx` reaches its integration fallback. `visual-layout.test.tsx` explicitly expects unavailable messages for these widgets. | Implement the actual runtime behavior, or clearly mark unavailable widgets in the palette and prevent misleading template use. Replace fallback acceptance with functional assertions as implementations arrive. |
| AAU-02 | High, template coverage | Both version-3 homepage manifests have only five rows: identity, navigation, welcome, key links and news. The approved template allowlist excludes hero_image, layout_slider, image_grid and other media compositions. An otherwise valid media-rich manifest is therefore unavailable. | Version a richer approved starter and its asset-binding flow. Resolve Site-owned image slots through the existing picker; do not hardcode AAU image URLs, foreign asset IDs or storage keys. Retain current draft/review/publication behavior. |
| AAU-03 | Medium, visual defect | Manifests embed site_logo/site_title/menu(header), while PublicMenus already renders the Site header. Assigning a primary menu can produce repeated branding/navigation inside the body. | Let the shared shell own header/footer; remove duplicate chrome from a new template version, retaining dynamic Site identity where it is intentional content. Never rewrite existing saved Pages automatically. |
| AAU-04 | Medium, layout limitation | PublicSiteChrome always wraps Page content in a padded maxWidth=lg Container. Page content_width=full is only 100% of that parent. AAU's edge-to-edge hero and campus bands cannot span the viewport through the existing setting. | Provide a validated full-bleed section/page policy in both preview and public shell. Preserve reading widths for ordinary content, sidebar layouts and legacy Pages. |
| AAU-05 | Medium, news presentation | LoopGridWidget renders uniform cards in a one/two-column grid. It does not offer a lead story beside a compact dated list. Its WidgetPost adapter drops publication date even if the source supplies it. | Add a typed news presentation variant and publication-date rendering using the existing published Site selector, with empty, missing-media and module-disabled behavior. |
| AAU-06 | Medium, interaction/presentation | ContentCarousel supports accessible previous/next controls, but has no direct slide selectors, wrap behavior or motion/transition configuration. Slides permit bounded leaf children rather than arbitrary row/column layouts. | Add only the needed validated carousel options. Keep manual operation usable without autoplay, label slide controls, and honor reduced motion. Explicitly design any richer slide layout contract instead of allowing unrestricted nesting. |
| AAU-07 | Medium, incomplete widget behavior | countdown displays a timestamp; video_player and google_maps render outbound links; icon renders its label. These are safe reduced behaviors but do not meet the names' full interactive expectations. | Document intentional link fallbacks or implement tested live countdown/player/map/icon behavior with privacy and provider policy. Avoid claiming these are fully featured. |
| AAU-08 | Medium, branding consistency | decorativeStyle uses hardcoded colors for navy/blue/gold and brand text/borders, rather than resolving all tokens from effective Site theme. | Resolve semantic tokens through the approved Site theme, retaining schema allowlisting and checking contrast for each supported combination. |
| AAU-09 | External integration / separate capability | No public Site-wide search, newsletter subscription workflow or chat integration was found in the reviewed CMS/public components. Contact Form is an inquiry workflow, not a newsletter subscription service. | Define Site-scoped search and approved subscription/chat providers before exposing controls. Prior instruction to continue with hero/styling/navigation/carousels does not approve invented provider destinations. |

The high priorities above are functional completeness defects, not newly demonstrated security vulnerabilities. This audit did not discover or certify absence of all security defects.

## Reference feature mapping

| Reference area | Current support | Work remaining |
| --- | --- | --- |
| Branded header and nested navigation | Shared hostname-scoped shell, published menu assignments, desktop disclosures, keyboard/mobile controls | Template chrome duplication; optional public search |
| Split-image hero carousel | HeroView supports split/reverse/overlay, curve/rounded masks, image position and multiple safe actions; layout_slider renders hero children | Approved template asset slots, full bleed and richer carousel presentation |
| Impact/statistics cards | Headline, Editor, Button and columns can compose static approved statistics | No dedicated metric/source/count-up contract; do not fabricate university numbers |
| Quick links | button_grid, safe links and existing Site menus | Template composition and styling |
| Campus-life and facilities panels | Hero, Image, Tabs, Accordion and content carousels provide parts | No ready-made composite; slide layout limits and reference-like overlays need design |
| Latest news | Site-scoped published Loop Grid and taxonomy filtering | Lead-story/list presentation, dates and polish |
| Campus exploration | Can compose hero/carousel with approved Site images and links | Asset slot setup and template composition |
| Featured partners | Can compose image/content carousel | No partner directory/source or reusable partner content type; approved logos and links needed |
| Newsletter and floating tools | Not implemented as those workflows | Provider/source configuration, consent/error/retry rules and integration tests |
| Footer | New shared Site footer supports branding, grouped published menu links, contacts, featured link, social profiles and copyright | Admin configuration of actual institution information; no copied AAU social profiles |

## Reproducible evidence

- Shared UI: **107 passed**, running:
  `docker compose exec -T frontend-admin pnpm --filter @uog/ui test src/visual-layout.test.tsx src/visual-presentation.test.tsx src/widget-runtime.test.tsx src/responsive-layout.test.tsx src/site-navigation.test.tsx`
- Backend catalogue/runtime: **26 passed**, running:
  `docker compose exec -T backend pytest apps/cms/tests/test_homepage_templates.py apps/cms/tests/test_widget_runtime.py -q --reuse-db`
- These passing suites prove their assertions only. The renderer parity suite deliberately accepts eight placeholders; its success is not full widget acceptance.
- Machine-readable 43-widget source inventory: [catalogue-inventory.json](catalogue-inventory.json). An explicit handler is not sufficient proof of complete feature behavior.
- Read-only browser regression: `scripts/qa-public-presentation.cjs`, with `UOG_PUBLIC_REVIEW_OUTPUT=.git/task-data/aau-audit/local`. Results cover overflow, header/footer/H1 count, mobile controls and automated WCAG A/AA checks on the exercised pages.
- Machine-local reference evidence: `.git/task-data/aau-audit/reference.png` and `reference.json`. Reference media is evidence only; no AAU photographs, logo or text were added as UoG production assets.

## Recommended delivery order

1. Complete or accurately disable the eight fallback widgets and add a meaningful renderer capability gate.
2. Upgrade the University Main and College/Department starter versions with shared-shell ownership and a safe Site-media binding step. Include the split hero carousel, approved statistics/cards, quick links, campus panels, scoped news and partnership sections.
3. Implement full-bleed sections, the featured-news variant and accessible slide selectors consistently across builder preview and public rendering.
4. Run an admin-only two-Site exercise: choose template, bind images, save, reopen, preview, review, publish and assign homepage. Verify Main and child independence and revision restore.
5. Add newsletter/search/chat only under their separately approved service contracts. Keep them absent until they work.

No existing Page, published snapshot, homepage assignment, menu assignment or Site content was changed by this audit. Prior footer changes remain in the working tree. No production-readiness or external review sign-off is asserted.

Browser result: all nine Site/viewport combinations passed with no horizontal overflow, one shared header/footer/H1 and zero automated axe violations. These checks used the current published fixtures; they do not establish that an AAU-equivalent template has been built or that every catalogue widget works.


Implementation follow-up: see [shared homepage completion](../shared-homepage-completion-2026-11-22/README.md) for the later remediation and verification. The findings above describe the pre-remediation audit state.
