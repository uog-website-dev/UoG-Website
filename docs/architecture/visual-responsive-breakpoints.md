# Visual layout responsive breakpoints

Shared resolution for Visual Builder canvas/private preview and public output.

## Tokens and widths

| Token | Preview width | Resolve range |
| --- | --- | --- |
| `desktop` | 1280 | ≥ 1280 (base surface; no override object) |
| `tablet` | 768 | 768–1279 |
| `mobile` | 390 | ≤ 767 |

Override objects may only use `tablet` and `mobile`.

## Restricted property set

| Node | Properties | Values |
| --- | --- | --- |
| Section | `stack`, `gap` | `stack`: boolean; `gap`: `none\|sm\|md\|lg` |
| Widget | `gap` | `none\|sm\|md\|lg` |

## Precedence and reset

1. Start from desktop `style` (defaults: `gap=md`, stack when container width &lt; 900).
2. If the active token is tablet or mobile, apply `responsive.tablet` keys that are present.
3. If the active token is mobile, apply `responsive.mobile` keys that are present.
4. Reset = delete the property key (and drop empty breakpoint objects). Missing keys inherit.

Legacy layouts without `responsive` keep the historical 900px stack threshold and base spacing.

## Shared helpers

- `@uog/types`: `resolveSectionPresentation`, `resolveWidgetPresentation`, `resetResponsiveProperty`, `setResponsiveProperty`, `precedenceMatrix`
- Renderer: `VisualLayoutView` / `PublicPageView` accept optional `viewportWidth` for forced preview parity; public pages measure the layout container when omitted.
