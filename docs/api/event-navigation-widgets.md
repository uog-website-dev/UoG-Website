# Events navigation & widgets

Site Administrators place **Events & Calendar** in Header, Footer, or Sidebar menus and reuse approved Loop Grid / Blog widgets for upcoming Event cards. No separate Event homepage editor and no new Calendar widget were added: the public `/events` page already provides directory + calendar views.

## Menu destination

| Field | Value |
| --- | --- |
| `item_type` | `events` |
| Label (UI) | Events & Calendar |
| Resolved href | Site `public_list_path` (default `/events`) when EVENTS is enabled |

Requires MENUS + EVENTS. When EVENTS is disabled, published menu delivery omits the item (`destination_status` becomes unavailable) and `targets.eventsAvailable` is false. Cross-Site Event IDs are not accepted; the destination is Site-local only.

## Approved widgets (no registry expansion)

Reuse existing source-profile widgets with `source: "events"`:

- `loop_grid`, `blog`, `recent_posts`, `post_carousel`, `loop_carousel`

Settings already on the contract:

| Setting | Use for Events |
| --- | --- |
| `limit` | Item count (1–20) |
| `category` | Event category slug/id filter |
| `presentation` | `grid` / `list` / `featured` |
| `display` / `columns` | Layout |
| Site scope | Host Site public Events (+ Main aggregation when configured) |

Public widget query: `GET /api/v1/site-context/widgets/?source=events&limit=…&category=…&lifecycle=upcoming`.

Draft and foreign private Events are never returned. Disabled EVENTS module returns 404 without leaking prior results.

## Calendar

Visitors reach the Site calendar via the Events & Calendar menu destination (`/events`). A dedicated Calendar widget was **not** added because the approved registry already covers list/card/featured needs and the public Events page owns calendar UX.
