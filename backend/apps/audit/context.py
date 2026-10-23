"""Request/task context is isolated per thread/async task and DB transaction."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from ipaddress import ip_address
from uuid import UUID

from django.db import DEFAULT_DB_ALIAS, connections, transaction

_context = ContextVar("platform_audit_context", default=None)


@dataclass(frozen=True)
class AuditContext:
    actor_kind: str = "SYSTEM"
    actor_id: str = "system"
    request_id: str | None = None
    ip: str | None = None

    def __post_init__(self):
        if self.actor_kind not in {"USER", "SYSTEM"} or not isinstance(self.actor_id, str) or not self.actor_id.strip() or len(self.actor_id) > 255:
            raise ValueError("Audit context requires a valid actor kind and nonblank identity.")
        if self.request_id is not None:
            object.__setattr__(self, "request_id", str(UUID(str(self.request_id))))
        if self.ip is not None:
            object.__setattr__(self, "ip", str(ip_address(self.ip)))


@contextmanager
def audit_context(*, actor_kind="SYSTEM", actor_id="system", request_id=None, ip=None):
    token = _context.set(AuditContext(actor_kind, actor_id, request_id, ip))
    try:
        yield
    finally:
        _context.reset(token)


@contextmanager
def request_audit_context(request):
    # Resolve user lazily: DRF authenticates after Django middleware starts.
    token = _context.set(request)
    try:
        yield
    finally:
        _context.reset(token)


def current_audit_context():
    value = _context.get()
    if value is None:
        return AuditContext()
    if isinstance(value, AuditContext):
        return value
    user = getattr(value, "user", None)
    peer = value.META.get("REMOTE_ADDR")
    try:
        peer = str(ip_address(peer)) if peer else None
    except ValueError:
        peer = None
    authenticated = user is not None and user.is_authenticated
    return AuditContext(
        "USER" if authenticated else "SYSTEM",
        str(user.pk) if authenticated else "system",
        getattr(value, "request_id", None), peer,
    )


@contextmanager
def database_audit_context(*, using=DEFAULT_DB_ALIAS):
    context = current_audit_context()
    settings = {
        "audit.actor_kind": context.actor_kind, "audit.actor_id": context.actor_id,
        "audit.request_id": context.request_id or "", "audit.ip": context.ip or "",
    }
    # A savepoint also restores prior SET LOCAL values on any exception.
    with transaction.atomic(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute("SELECT " + ", ".join(["current_setting(%s, true)"] * len(settings)), list(settings))
            previous = dict(zip(settings, [value or "" for value in cursor.fetchone()]))
            values = [item for pair in settings.items() for item in pair]
            cursor.execute("SELECT " + ", ".join(["set_config(%s, %s, true)"] * len(settings)), values)
        yield
        with connections[using].cursor() as cursor:
            values = [item for pair in previous.items() for item in pair]
            cursor.execute("SELECT " + ", ".join(["set_config(%s, %s, true)"] * len(previous)), values)
