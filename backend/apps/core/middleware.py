"""Attach a bounded, validated correlation ID to every response."""
from uuid import UUID, uuid4
import re


class RequestIDMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get("X-Request-ID", "")
        try:
            request.request_id = str(UUID(supplied))
        except (ValueError, AttributeError):
            request.request_id = str(uuid4())
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        return response


class PerformanceMiddleware:
    """Opt-in aggregate timings. Never record SQL text, URL queries or credentials."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.conf import settings
        if not getattr(settings, "PERF_INSTRUMENTATION_ENABLED", False):
            return self.get_response(request)
        import json
        import logging
        from contextlib import ExitStack
        from time import perf_counter
        from django.db import connections
        totals = {"count": 0, "ms": 0.0}

        def execute(execute, sql, params, many, context):
            started = perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                totals["count"] += 1
                totals["ms"] += (perf_counter() - started) * 1000

        def identifier(header):
            try:
                return str(UUID(request.headers.get(header, "")))
            except (ValueError, AttributeError):
                return None

        navigation = identifier("X-Navigation-ID")
        parent = identifier("X-Parent-Request-ID")
        started = perf_counter()
        with ExitStack() as stack:
            for connection in connections.all():
                stack.enter_context(connection.execute_wrapper(execute))
            response = self.get_response(request)
        elapsed = (perf_counter() - started) * 1000
        response["Server-Timing"] = f'app;dur={elapsed:.3f}, db;dur={totals["ms"]:.3f}, sql;desc="{totals["count"]}"'
        response["X-SQL-Count"] = str(totals["count"])
        response["X-SQL-Time-Ms"] = f'{totals["ms"]:.3f}'
        if navigation:
            response["X-Navigation-ID"] = navigation
        if parent:
            response["X-Parent-Request-ID"] = parent
        match = getattr(request, "resolver_match", None)
        logging.getLogger("apps.performance").info(json.dumps({
            "event": "uog.django.request", "request_id": getattr(request, "request_id", None),
            "navigation_id": navigation, "parent_request_id": parent,
            "route": getattr(match, "route", None), "method": request.method,
            "resource_keys": {key: str(value) for key, value in getattr(match, "kwargs", {}).items()
                              if re.fullmatch(r"(?:[0-9]{1,12}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})", str(value))},
            "query_shape": {key: request.GET[key] for key in ("site", "page", "page_size", "status", "ordering")
                            if key in request.GET and (
                                (key in {"site", "page", "page_size"} and re.fullmatch(r"[0-9]{1,12}", request.GET[key]))
                                or (key == "status" and request.GET[key] in {"DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED", "READY", "FAILED", "PROCESSING", "PENDING", "REJECTED", "ACTIVE", "INACTIVE"})
                                or (key == "ordering" and request.GET[key] in {"name", "-name", "title", "-title", "created_at", "-created_at", "updated_at", "-updated_at", "published_at", "-published_at"}))},
            "status": response.status_code, "duration_ms": round(elapsed, 3),
            "sql_count": totals["count"], "sql_ms": round(totals["ms"], 3),
            "streaming_body_excluded": bool(response.streaming),
        }, separators=(",", ":")))
        return response
