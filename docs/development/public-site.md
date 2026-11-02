# Shared public Site

One public-web application serves every Site. The browser does not send a Site id. `GET /api/v1/site-context/` and the public page, post and menu routes use the trusted Host. `X-Forwarded-Host` is ignored.

A platform host such as `localhost` resolves to no Site. An unknown or inactive hostname is a 404 and does not borrow another Site.

## What each hostname renders

- Homepage: the published homepage for that Site, including its SEO title and description.
- Page route: `/news` loads `GET /api/v1/site-context/pages/news/`. A 308 `Location` is followed only when it stays on `/api/v1/site-context/pages/...`; the browser then opens that path on the current host.
- Posts: `/posts` and `/posts/{slug}` render only when POSTS is enabled for the resolved Site.
- Header and footer: rendered only when MENUS is enabled. A 404 leaves both empty.
- Theme: `institutional` or `high-contrast`, from the Site configuration. Other theme names stay on the institutional theme.

Draft, hidden, foreign-Site and module-off responses are not rendered. Disabling a module returns 404 and does not delete the rows.

## Cache

Public page, post and menu responses use `Cache-Control: public, max-age=0, must-revalidate` and `Vary: Host`. The browser fetch uses `cache: "no-store"`, so the next publish or unpublish is the next response. Site context itself is `private, no-store`.

## Evidence

- `backend/apps/cms/tests/test_public_site_hosts.py` — main plus two colleges, slug collision, redirect, draft, `X-Forwarded-Host`, cache header, unpublish, and module disable.
- `frontend/packages/ui/src/public-site.test.tsx` — distinct host context, module-gated posts link, safe redirect path, and cache mode.
- `frontend/packages/ui/src/public-page.test.tsx` — script and `javascript:` targets are not mounted; a keyboard user can reach a safe link.
- `frontend/packages/ui/src/site-navigation.test.tsx` — header and footer, unsafe menu targets, and the mobile header opened from the keyboard and closed with Escape.

No API path or schema changed for this proof, so the OpenAPI snapshot and migrations are unchanged.
