# Event P0 rollback / recovery notes

## Application rollback

1. Disable the `EVENTS` module per Site to stop public surfaces (404) and management writes (403) without deleting Event rows.
2. Unpublish Event updates and set resource/gallery visibility to `DRAFT` for hot content mistakes.
3. Cancel or archive a published Event via Site Admin actions (`cancel` / `archive`) — cancelled Events remain visible with notice; archived Events leave the public directory.
4. Soft-removed participants/resources retain audit history; hard purge is out of band.

## Database / migrations

- Event schema migrations through the EVENT-001–014 leaf set must be present before release.
- Rollback of migrations is not the primary recovery path. Prefer module disable + content actions.
- Backup/recovery smoke: restore a recent PostgreSQL backup to a staging clone and confirm Event list/detail and registration create against the restored dataset (coordinate with infrastructure).

## Cache

- Public updates/notices: revalidate within 30s (`PUBLIC_UPDATES_MAX_AGE`).
- Event detail / agenda / speakers: `max-age=0, must-revalidate` with section ETags.
- File downloads: `private, no-store` — revoke by unpublishing resource or cancelling registration entitlement grants (short-lived).

## Object storage

- Event resources/gallery rely on Documents/Media. Quarantined or non-READY assets cannot be attached or served.
- No long-lived public object URLs are issued by Event download APIs.
