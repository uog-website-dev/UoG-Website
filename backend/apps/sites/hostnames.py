"""Normalize institutional hostnames. A domain is not a URL and not a DNS proof."""
import re

from django.core.exceptions import ValidationError

_LABEL = re.compile(r"\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
_STORED = re.compile(
    r"\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\Z"
)
DEFAULT_PORTS = {"80", "443"}


def normalize_hostname(value):
    """Return the canonical hostname, or reject paths, userinfo and odd ports."""
    if not isinstance(value, str):
        raise ValidationError({"hostname": "A hostname is required."})
    host = value.strip().lower()
    if not host or any(mark in host for mark in ("://", "/", "\\", "?", "#", "@", " ")):
        raise ValidationError({"hostname": "Domain values are hostnames, not URLs or paths."})
    if host.endswith("."):
        host = host[:-1]
    if host.count(":") == 1:
        name, port = host.rsplit(":", 1)
        if port not in DEFAULT_PORTS or not name:
            raise ValidationError({"hostname": "Only a hostname is stored. Non-default ports are rejected."})
        host = name[:-1] if name.endswith(".") else name
    elif ":" in host:
        raise ValidationError({"hostname": "Domain values are hostnames, not URLs or paths."})
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValidationError({"hostname": "The hostname is not valid internationalized text."}) from exc
    if len(host) > 253 or _STORED.fullmatch(host) is None or any(_LABEL.fullmatch(label) is None for label in host.split(".")):
        raise ValidationError({"hostname": "The hostname is not a valid domain name."})
    return host
