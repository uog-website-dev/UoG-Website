"""Allow only the Site host resolved for this request past Django's host check."""
from contextvars import ContextVar

_resolved_host = ContextVar("resolved_site_host", default=None)
_installed = False


def bind_resolved_host(host):
    return _resolved_host.set(host)


def reset_resolved_host(token):
    _resolved_host.reset(token)


def current_resolved_host():
    return _resolved_host.get()


def install_host_check():
    global _installed
    if _installed:
        return
    from django.http import request as request_module

    original = request_module.validate_host

    def validate_host(host, allowed_hosts):
        if original(host, allowed_hosts):
            return True
        resolved = _resolved_host.get()
        return bool(resolved) and host == resolved

    request_module.validate_host = validate_host
    _installed = True
