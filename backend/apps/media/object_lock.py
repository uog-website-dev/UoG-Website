"""Per-asset session mutex for remote I/O; never holds the platform write guard.

Processing and cleanup share this mutex. Deletion may commit during a PUT, but
cleanup cannot finish until that PUT exits. A dead worker releases the session
lock; durable processing leases and the cleanup outbox recover its work.
"""
from contextlib import contextmanager
from uuid import UUID
from django.db import connections


@contextmanager
def object_operation(asset_id, *, using="default"):
    db = connections[using]
    key = "uog.media.object:" + str(UUID(str(asset_id)))
    with db.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(hashtextextended(%s,0))", [key])
        acquired = cursor.fetchone()[0]
    try:
        yield acquired
    finally:
        if acquired:
            # Failed atomic blocks have unwound before reaching this session unlock.
            with db.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", [key])
