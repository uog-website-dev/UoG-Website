"""Shared wire format for handled DRF errors; never expose internal errors."""
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    cause = getattr(exc, "__cause__", None)
    if getattr(getattr(cause, "diag", None), "constraint_name", None) == "audit_write_failed":
        from rest_framework.exceptions import APIException
        unavailable = APIException("Audit persistence is unavailable. No change was committed.")
        unavailable.status_code = 503
        exc = unavailable
    response = exception_handler(exc, context)
    if response is None:
        return None  # Preserve Django's handling/logging of unexpected exceptions.
    details = response.data
    messages = {
        400: ("validation_error", "The request is invalid."),
        401: ("not_authenticated", "Authentication failed or credentials are missing."),
        403: ("permission_denied", "You do not have permission to perform this action."),
        404: ("not_found", "The requested resource was not found."),
        405: ("method_not_allowed", "This HTTP method is not allowed."),
        406: ("not_acceptable", "The requested response format is unavailable."),
        409: ("conflict", "The request conflicts with the current resource state."),
        412: ("precondition_failed", "The resource changed. Retrieve it and reconcile your changes."),
        415: ("unsupported_media_type", "The request content type is unsupported."),
        429: ("throttled", "Too many requests."),
        428: ("precondition_required", "A current If-Match header is required."),
        503: ("service_unavailable", "The service is temporarily unavailable."),
    }
    code, message = messages.get(response.status_code, ("api_error", "The request failed."))
    response.data = {
        "error": {"code": code, "message": message, "details": details},
        "request_id": getattr(context.get("request"), "request_id", None),
    }
    return response
