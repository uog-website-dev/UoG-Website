# Hostname site resolution

Each request's browser `Host` header is normalized and looked up in
`SiteDomain`. The matching active Site is `request.site`. No institutional
hostname is listed in application code. Adding a SiteDomain row is enough
for a new website; no deploy is required for the name itself.

`X-Forwarded-Host` is not read. `USE_X_FORWARDED_HOST` is false. Nginx
overwrites that header with the host it accepted. `ALLOWED_HOSTS` remains
the platform names (`localhost`, `127.0.0.1`, `backend`, and `testserver`
in tests). A Site hostname is admitted only for the request that resolved
it.

Unknown hosts, inactive domains, and Sites that are not `ACTIVE`
(draft, suspended, archived) get the same 404. That lookup does not
authenticate the caller or grant an Organization permission. Alias domains
with `redirect_to_primary` redirect only to the stored primary hostname.

Cache keys include `site:{id}` or `site:platform`. Session and CSRF cookies
are host-only (`SESSION_COOKIE_DOMAIN` and `CSRF_COOKIE_DOMAIN` are unset),
so one website does not receive another's session.

The development ingress still accepts only `localhost` and `127.0.0.1`
before a request reaches Django. Django applies this resolver to the Host
that proxy forwards. A resolved Site hostname is allowed only for that
request; it is not added to `ALLOWED_HOSTS`.

`GET /api/v1/site-context/` returns the selected Site code, owner, hostname
and enabled module codes. Anonymous callers may read it. It grants no
administration permission. Representative hostnames such as `www.uog.local`
exist only as development data in `apps/sites/fixtures/uog-foundation.json`.
Adding another hostname is a SiteDomain row, not an application change.
The [foundation gate](../development/site-foundation.md) creates four Sites
through the API and then one more organization, Site, domain and module
enablement without a new migration.
