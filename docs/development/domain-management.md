# Domain Management — usage and verification

How the administration console manages SITE domains, how the public website
resolves them, and the evidence that the whole chain works end to end. The
user-visible flow lives in two places:

- the central **Domains** list (`domains-list.tsx`), read-only: every
  hostname with its Site, organization, type and status;
- the per-site **Site Domain Overview** panel (`site-domains-panel.tsx`,
  rendered on each site's detail page), which owns every lifecycle change.

## 1. Real-API integration (no mock on the production path)

- All domain reads and writes go through server actions
  (`frontend/apps/admin-web/src/app/sites/actions.ts`), which use the shared
  typed api-client against the Django REST API. The Keycloak access token
  stays server-side; the browser never sees it.
- Transport choice is explicit (`@uog/api-client` `src/adapters/mode.ts`):
  `API_MODE=live` selects the live adapter; `API_MODE=mock` selects local
  fixtures and is **refused outright in a production build**
  (`ApiModeError`). A deployed integration cannot serve fabricated data.
- Every write is conditional on a strong `ETag` fetched inside the server
  action, so a stale row answers HTTP 412 instead of silently overwriting.
- Lifecycle endpoints per `docs/api/sites.md`: creation and status edits are
  `POST/PATCH /api/v1/sites/{site_pk}/domains/…`, the primary designation is
  moved by `POST …/domains/{id}/set-primary/`, and deactivation can carry
  `{ "replacement": id }` when the row to turn off is the *active primary*.

## 2. The Site Domain Overview panel

Rendered on each site's detail page, scoped to exactly **one** Site (named
in the panel header, e.g. `Site domain overview for UOG_MAIN — University of
Gondar`). It displays:

| Element | Where it comes from |
| --- | --- |
| Primary domain | the row with `is_primary = true` (exactly one, enforced by the backend) |
| Alias domains | every other row, labelled `Alias` |
| Domain status | `Active` / `Inactive` chip per row, plus the `Primary` / `Alias` type chip |
| Associated Site | stated in the panel header — never inferred from the hostname |
| Public website preview link | active rows only, `//<hostname>` (protocol-relative; the platform does not provision DNS or TLS) |
| Lifecycle info | `Lifecycle: added <UTC timestamp> · last updated <UTC timestamp>` |
| Redirect warning | `Redirects to the primary domain` on alias rows with `redirect_to_primary` |

### Lifecycle actions

- **Set as primary** (aliases): confirmed first with both hostnames named —
  "New primary" and "Current primary (stays as an alias)". Applied through
  the backend's atomic `set-primary` action; the Site always keeps exactly
  one primary. An inactive alias may be designated; the dialog warns that it
  must be activated afterwards to serve traffic.
- **Activate** (inactive rows): re-enables the routing record. On an
  archived Site the backend refuses and the reason is shown.
- **Deactivate** (active rows): an alias deactivates with no payload. The
  **active primary requires a replacement**: the panel offers only other
  ACTIVE domains of the same Site; with none available it states that the
  server would reject the change; and it refuses to submit until a
  replacement is chosen. The backend independently re-checks both rules.
- While any confirmation is open or a write is in flight, **all row actions
  are disabled** — conflicting lifecycle operations cannot be issued at once.

### Status and error messaging

- Read failures degrade to an explicit "could not be loaded" notice with the
  backend correlation id — never an empty panel implying "no domains".
- Writes failing with HTTP 400 render the actionable field sentences from
  the error envelope's `details` (e.g. *"Select an active domain on this
  Site before deactivating the primary."*) together with the request id.
- Permission failures surface the 403 wording ("Writing domains is not
  enabled in this environment…"), conflicts the 409 wording, stale rows the
  412 wording. Collectively: unauthorised domain changes are rejected and
  shown, never swallowed.
- After a failure the dialog/list stays open with entered data preserved;
  after a success the panel reloads and the site profile refreshes.
  Refreshing the browser re-reads everything through the server actions, so
  domain state is consistent with the backend after any page reload.

## 3. Public hostname resolution (approved Nginx setup)

Django's `SiteResolutionMiddleware` (`backend/apps/sites/middleware.py`)
resolves every request from the **browser Host header** against
`SiteDomain` rows: unknown or deactivated hostnames and suspended/archived
Sites answer HTTP 404 (fail-closed); an alias with `redirect_to_primary`
answers HTTP 302 to the stored primary hostname; `X-Forwarded-Host` is
never read; platform hosts (localhost) resolve no Site. Nginx passes the
Host through unchanged (`proxy_set_header Host $host`) and overwrites any
client-supplied `X-Forwarded-Host`.

The public Next.js app calls `GET /api/v1/site-context/` on
`frontend/apps/public-web` and displays the **resolved Site, domain and
enabled modules** for the current host — or states that a platform host
resolves no Site. It never guesses.

### Configured development hostnames

The Sites foundation seed (apps/sites/fixtures/uog-foundation.json) creates
one primary hostname per Site:

| Hostname | Site |
| --- | --- |
| `www.uog.local` | MAIN |
| `informatics.uog.local` | INFORMATICS |
| `medicine.uog.local` | MEDICINE |
| `research.uog.local` | RESEARCH |

Development admission was extended accordingly
(`infrastructure/nginx/conf.d/platform.conf`): the ingress now accepts
`localhost`, `127.0.0.1` (its regex had a doubled-backslash escape that
rejected `127.0.0.1` outright) and `*.uog.local`; `docker-compose.yml`
adds `.uog.local` to the backend's `ALLOWED_HOSTS` so Django accepts the
Host (the leading dot keeps it out of the middleware's platform-host list,
so these hosts still resolve Sites). Production keeps
`localhost,127.0.0.1` and receives its real domains via the environment.

### Verification commands (hostnames through nginx, from the docker host)

```bash
# Primary domain resolves its Site
curl -si -H "Host: www.uog.local"        http://localhost/api/v1/site-context/   # 200 — Site MAIN
curl -si -H "Host: informatics.uog.local" http://localhost/api/v1/site-context/  # 200 — Site INFORMATICS

# Alias redirect: create the alias in the admin console with
# redirect_to_primary, then
curl -si -H "Host: <alias.uog.local>"     http://localhost/api/v1/site-context/  # 302 — Location: http://<primary>/

# Unknown host and inactive (deactivated primary) host fail closed
curl -si -H "Host: unknown.uog.local"     http://localhost/api/v1/site-context/  # 404 not_found

# Deactivate a Site's active primary via the console (choose a replacement),
# deactivate the replacement too — the Site's hostnames then answer 404.

# Platform host resolves no Site
curl -si http://localhost/api/v1/site-context/                                   # 200 — site: null

# Header spoofing is ignored
curl -si -H "Host: informatics.uog.local" -H "X-Forwarded-Host: medicine.uog.local" \
     http://localhost/api/v1/site-context/                                       # 200 — Site INFORMATICS
```

Browsers resolve `.local` via mDNS; for browser-based checks add the names
to the machine's hosts file, or exercise them with `curl`/scripts as above.

## 4. Site-scoped access and authorisation

- Domains are nested under `/api/v1/sites/{site_pk}/domains/…`; a row of
  another Site answers 404 (`backend/tests/test_site_foundation.py:
  `get …/domains/<other site's id>/ → 404'`). No cross-Site leak.
- Writes require an authenticated platform administrator; anonymous calls
  answer 401 (`test_resolution.py`), and a scoped (non-admin) token is
  rejected by permission checks.
- The console's confirm-first flows apply to dangerous transitions only;
  the security decisions live on the backend.

## 5. Automated coverage of the core domain workflow

Backend (pytest, `backend/apps/sites/tests`, `backend/tests`):

- resolution matrix: primary/alias/other-Site resolution, alias 302,
  unknown 404, deactivated-primary 404, suspended/archived 404, platform
  host null, forwarded-host ignored, cache/cookie separation
  (`test_resolution.py`);
- domain model rules: normalization, immutability, exactly one primary,
  duplicate rejection, resolver semantics (`test_site_domain.py`, …);
- lifecycle service rules incl. primary replacement transactions
  (`apps/sites/services/domains.py`, exercised by the tests above and
  `backend/tests/test_sites_api.py`).

Frontend (vitest):

- `frontend/packages/api-client` — **127/127** passing, incl. the
  `set-primary/` URL, deactivate payloads (`{}` vs `{replacement}`), mock
  primary-swap success/rejections, and the production mock refusal.
- `frontend/apps/admin-web` — **207/207** passing, incl. the panel suite
  (successful and rejected activate/deactivate/set-primary, replacement
  selection, backend 400 detail sentences, in-flight locking, read-failure
  and empty states) and the dialog guard (no plain status switch-off for the
  active primary).

Public app: displays `GET /api/v1/site-context/` results verbatim; resolution
behaviour itself is asserted by the backend suites above (all runs on
2026-10-28, uncommitted working tree).

## 6. Known limitations (honest scoping)

- DNS records, TLS certificates and per-hostname health checks are *not*
  provisioned by the platform; the UI never claims otherwise.
- The public app is currently a wiring reference (pages + site context),
  not a themed institutional website; the resolution surface it demonstrates
  is production machinery from the backend.
- `.local` is mDNS-reserved: for real browser navigation during development,
  map the seed hostnames in the local hosts file.
