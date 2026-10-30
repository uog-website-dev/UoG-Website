# Public menu delivery

Visitors receive navigation for the Site selected from the trusted Host.
`GET /api/v1/site-context/menus/` accepts an optional `location` of `header`,
`footer`, `sidebar`, `primary` or `secondary`. A Site id in the query string
is rejected. `X-Forwarded-Host` is ignored. Responses vary by Host and are
`Cache-Control: public, max-age=0, must-revalidate`.

## Precedence

Each location is composed independently. With no `MenuInheritance` row the
Site receives only its own active local menu.

| Segment | When it appears | Order |
| --- | --- | --- |
| Global | `include_global` and the main Site has an active global menu for the location | First |
| Inherited | `inherit_from` points at an active Site whose MENUS module is on, and this Site is not overriding | After global |
| Local | This Site has an active non-global menu | Last, unless it overrides |

`local_precedence=override` drops the inherited segment whenever the local
menu is active, including when every local item is hidden. `append` keeps
the inherited segment and adds local items after it. An inactive or missing
local menu does not override, so the inherited segment remains.

Inheritance copies the parent Site's **local** menu only. It does not copy
the parent's global fragment or the parent's own parent. A Site that wants
the grandparent menu must set `inherit_from` to that Site. The chain cannot
include the same Site twice and cannot exceed eight hops. A child editor with
`menu.write` may set `inherit_from` and still receives `403` for the parent
Site's menu administration API.

Global menus are `is_global` rows owned by the main Site, one per location.
Another Site cannot create one.

## Unavailable targets

Inactive items hide their descendants. A page link is included only when that
Page is `PUBLISHED` and `PUBLIC` or `UNLISTED`. A post link is included only
when `is_published` is true. Draft, hidden, unpublished and missing targets
are omitted with their descendants. External and custom items remain.
Cross-site page or post targets also require `allow_cross_site`.

The public item is `{label, href, source, children}`. `source` is `global`,
`inherited` or `local`. `href` is the external URL, the custom path, the Page
path, or `/posts/{slug}`. Item ids, menu versions and other Sites' draft
labels are not included.

A disabled MENUS module on the resolved Site returns the same not-found
response as an unknown menu and does not delete rows. A disabled module on
the parent Site omits only the inherited segment.

## Cache

Each Site and location has a `MenuDeliveryVersion`. The cache key is stored
under that Site's cache prefix, so one Site cannot read another's entry.
Changing a local menu bumps the owner and Sites that inherit from it for that
location. Changing a global menu bumps the main Site and Sites with
`include_global` for that location. Changing a delivery policy bumps only the
Site that owns the policy. Other Sites and other locations keep their
generations.

Administration is `GET/PUT /api/v1/sites/{site_id}/menu-inheritance/{location}/`
with `menu.read` and `menu.write`. PUT body:

```json
{"inherit_from": 12, "include_global": true, "local_precedence": "append"}
```

`inherit_from` may be null. Loops return `400` with `inheritance_loop`.
