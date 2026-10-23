"""Attach a bounded, validated correlation ID to every response."""
from uuid import UUID, uuid4


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
