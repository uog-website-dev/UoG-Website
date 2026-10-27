# Site domains

A SiteDomain is a hostname assigned to one Site. Storing it does not mean
DNS or a TLS certificate has been provisioned. Only an `ACTIVE` domain on an
`ACTIVE` Site resolves. Inactive domains do not resolve.

| Field | Contract |
| --- | --- |
| site | Required FK to Site, `PROTECT`, related name `domains` |
| hostname | Globally unique normalized hostname, at most 253 characters |
| is_primary | At most one true value per Site, enforced by a partial unique index |
| redirect_to_primary | Optional alias behavior. False on a primary domain |
| status | `ACTIVE` or `INACTIVE`. New rows start `INACTIVE` |
| created_at / updated_at | Timezone-aware timestamps |

Normalization lowercases the value, removes one trailing dot, strips default
ports `80` and `443`, and encodes international labels with IDNA. Schemes,
paths, userinfo and any other port are rejected. The stored form is checked
again in PostgreSQL, so bulk writes cannot keep mixed case or a path.

Changing `site` is rejected unless `reassign_domain` sets the
transaction-local reassignment flag. Hostnames are immutable. A primary
hostname must be cleared before it can move. `designate_primary` clears the
previous primary in the same locked transaction. Concurrent primary writes
that skip that operation still leave one primary because of
`site_domain_one_primary`.

An active primary cannot be set inactive, by the API or by a direct update,
until another active domain of the same Site has been designated primary.
`deactivate_domain(..., replacement_id=)` does both steps in one transaction.
The administration path is `POST /api/v1/sites/{site_pk}/domains/{id}/set-primary/`
and `POST .../deactivate/`.

`sites.0007_sitedomain_audit` records `SITE_DOMAIN_CREATED`,
`SITE_DOMAIN_UPDATED`, `SITE_DOMAIN_PRIMARY_CHANGED` and
`SITE_DOMAIN_DEACTIVATED` through the shared audit writer. The snapshot is
`site_id`, `hostname`, `is_primary`, `redirect_to_primary` and `status`.

`sites.0003_sitedomain` creates the table, constraints and triggers.
