# Visual Builder responsive breakpoint overrides — 2026-11-12

Site Editors can fine-tune approved layout properties at tablet and mobile
breakpoints. Resolution is shared between editor preview and public output.
Invalid tokens fail closed. Legacy layouts without `responsive` keep default
rendering.

Dependencies: P3-BUILDER-001, P3-FE-BUILDER-003–004, P3-PUBLIC-001–003.

## Contracts

- Precedence matrix: [precedence-matrix.json](precedence-matrix.json)
- Parity fixtures: [parity-fixtures.json](parity-fixtures.json)
- Architecture: [visual-responsive-breakpoints.md](../../architecture/visual-responsive-breakpoints.md)
- Layout contract addendum: [visual-layout-contract.md](../../architecture/visual-layout-contract.md)

## Breakpoint contract and parity across target widths

| Width | Token | Preview / public parity | Evidence |
| --- | --- | --- | --- |
| 390 | mobile | Same `data-resolved-*` attributes | `responsive-layout.test.tsx` |
| 767 / 768 | mobile / tablet boundary | Same attributes each side | Parity loop + matrix |
| 900 / 1279 / 1280 | tablet / desktop | Legacy stack threshold preserved; desktop ignores overrides | Resolution + parity tests |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Overrides affect only intended widths and can be reset to inherit | **PASS** | Resolution tests + builder UX inherit reset |
| Invalid breakpoints and properties fail validation | **PASS** | Shared fixtures + backend `test_responsive_overrides_*` |
| Mobile-only spacing applies at target width; reset restores inheritance in preview and public | **PASS** | Parity fixtures + UI tests |

## Results

| Suite | Result |
| --- | --- |
| Backend `test_layout_contract.py` | Shared fixtures + responsive API cases ([backend.xml](backend.xml)) |
| UI `responsive-layout.test.tsx` | Matrix, inheritance, parity ([ui-responsive.xml](ui-responsive.xml)) |
| Admin `visual-builder.test.tsx` | Mobile spacing override + Inherit reset + viewport chrome |
