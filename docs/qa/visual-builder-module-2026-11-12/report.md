# Visual Page Builder Site module — 2026-11-12

`VISUAL_BUILDER` is a shipped Site module, managed like Pages/Posts/Menus.
Platform administrators enable it globally; Site administrators enable it per
Site. It requires `PAGES` on the same Site. The Site Administration **Visual
Builder** menu appears only when the module is enabled and the user can update
Pages. Visual draft APIs reject writes when the module is off.

## Evidence

| Suite | Result |
| --- | --- |
| Backend module + drafts + integrated | 8 passed |
| Admin UI site-admin / visual-builder / homepage | 31 passed |

## Acceptance

| Criterion | Status |
| --- | --- |
| Platform/Site enable-disable like other content modules | PASS |
| Menu only for Sites with VISUAL_BUILDER enabled | PASS |
| Direct builder routes and draft APIs gated | PASS |
| Requires PAGES; cannot disable PAGES while builder stays on | PASS |
