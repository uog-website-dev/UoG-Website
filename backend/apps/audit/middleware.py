from .context import request_audit_context


class AuditContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        with request_audit_context(request):
            return self.get_response(request)
