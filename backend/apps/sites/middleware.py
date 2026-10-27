"""Choose request.site from the Host header and the SiteDomain table.

This is routing, not authorization. X-Forwarded-Host is never read.
"""
from urllib.parse import urlunsplit

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.http.request import DisallowedHost, split_domain_port

from apps.core.cache import bind_cache_site, reset_cache_site

from .allowed_hosts import bind_resolved_host, reset_resolved_host
from .selectors.domains import resolve_hostname


class SiteResolutionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.site = None
        request.site_domain = None
        request.enabled_module_codes = frozenset()
        host = _hostname(request)
        cache_token = bind_cache_site(None)
        host_token = None
        try:
            if host is None:
                return _vary(_closed())
            if _platform_request(host):
                return _vary(self.get_response(request))
            resolved = resolve_hostname(host)
            if resolved is None:
                return _vary(_closed())
            redirect = resolved["redirect_hostname"]
            if redirect:
                return _vary(_redirect(request, redirect))
            request.site = resolved["site"]
            request.site_domain = resolved["domain"]
            request.enabled_module_codes = _enabled_module_codes(request.site)
            reset_cache_site(cache_token)
            cache_token = bind_cache_site(request.site.pk)
            host_token = bind_resolved_host(host)
            return _vary(self.get_response(request))
        finally:
            reset_cache_site(cache_token)
            if host_token is not None:
                reset_resolved_host(host_token)


def _enabled_module_codes(site):
    from .selectors.modules import available_module_codes
    return available_module_codes(site.pk, using=site._state.db or "default")


def _hostname(request):
    """Return the browser Host. Never read X-Forwarded-Host."""
    if "HTTP_HOST" in request.META:
        raw = request.META.get("HTTP_HOST") or ""
    else:
        raw = request.META.get("SERVER_NAME") or ""
        port = str(request.META.get("SERVER_PORT") or "")
        if port and port not in {"80", "443"}:
            raw = f"{raw}:{port}"
    if not raw or "," in raw or "\n" in raw or "\r" in raw:
        return None
    try:
        domain, _port = split_domain_port(raw)
    except DisallowedHost:
        return None
    return domain.lower() if domain else None


def _platform_request(host):
    names = set()
    for pattern in settings.ALLOWED_HOSTS:
        if pattern and pattern != "*" and not str(pattern).startswith("."):
            names.add(str(pattern).lower())
    names.add("testserver")
    return host.lower() in names


def _closed():
    return JsonResponse(
        {"error": {"code": "not_found", "message": "The requested resource was not found.", "details": {}}},
        status=404,
    )


def _redirect(request, hostname):
    if any(mark in hostname for mark in (":", "/", "\\", "@", "?", "#")):
        return _closed()
    scheme = "https" if request.is_secure() else "http"
    target = urlunsplit((scheme, hostname, request.path, request.META.get("QUERY_STRING", ""), ""))
    response = HttpResponse(status=302, headers={"Location": target})
    response["Cache-Control"] = "private, no-store"
    return response


def _vary(response):
    current = response.get("Vary", "")
    if "host" not in current.lower():
        response["Vary"] = "Host" if not current else f"{current}, Host"
    return response
