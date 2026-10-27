"""OpenAPI integration shared by platform domains."""
from drf_spectacular.extensions import OpenApiAuthenticationExtension


class KeycloakBearerScheme(OpenApiAuthenticationExtension):
    target_class = "apps.accounts.authentication.KeycloakBearerAuthentication"
    name = "keycloakBearer"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http", "scheme": "bearer", "bearerFormat": "JWT",
            "description": (
                "Keycloak access token. Signature, issuer, audience, expiry and "
                "authorized client are verified by the backend. Paste only the JWT. "
                "Staff access and platform-admin role checks remain enforced."
            ),
        }


def add_common_contract(result, generator, request, public):
    """Describe headers and common DRF errors without duplicating every view."""
    schemas = result.setdefault("components", {}).setdefault("schemas", {})
    schemas["APIError"] = {
        "type": "object", "required": ["error", "request_id"],
        "properties": {
            "error": {
                "type": "object", "required": ["code", "message", "details"],
                "properties": {
                    "code": {"type": "string", "example": "validation_error"},
                    "message": {"type": "string", "example": "The request is invalid."},
                    "details": {"description": "Field errors or a detail message from DRF."},
                },
            },
            "request_id": {"type": "string", "format": "uuid"},
        },
    }
    descriptions = {
        "400": "Invalid body, malformed input, or validation failure.",
        "401": "Missing, expired or invalid Keycloak credentials.",
        "403": "Authenticated caller lacks permission, or session CSRF failed.",
        "404": "Resource or requested page does not exist.",
        "405": "Method is not supported.",
        "406": "Requested response format is unavailable.",
        "409": "Duplicate normalized code, database integrity/concurrent transaction conflict, or hierarchy response exceeding 1000 nodes. Reconcile state or navigate smaller branches/use the paginated list.",
        "412": "If-Match does not match the current strong ETag. Retrieve and reconcile changes.",
        "428": "If-Match header is required for this mutation.",
        "415": "Unsupported request content type.",
        "503": "Audit persistence failed; the entire organization mutation was rolled back. No SQL details are exposed.",
    }
    for path, item in result.get("paths", {}).items():
        for method, operation in item.items():
            if method not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            operation.setdefault("parameters", []).append({
                "name": "X-Request-ID", "in": "header", "required": False,
                "description": "Optional UUID correlation ID. Invalid values are replaced.",
                "schema": {"type": "string", "format": "uuid"},
            })
            codes = {"401", "403", "405", "406"}
            if method in {"post", "put", "patch"}:
                codes.update({"400", "415"})
            if "{" in path or (method == "get" and path == "/api/pages/"):
                codes.add("404")
            responses = operation.setdefault("responses", {})
            if path.startswith(("/api/v1/organizations/", "/api/v1/sites/", "/api/v1/site-templates/", "/api/v1/modules/")):
                hierarchy = path.startswith("/api/v1/organizations/") and path.rstrip("/").split("/")[-1] in {"tree", "children", "ancestors", "descendants", "subtree"}
                if method == "get" and "{" not in path and not hierarchy:
                    codes.update({"400", "404"})
                if hierarchy and method == "get":
                    codes.add("409")
                if method in {"post", "patch"}:
                    codes.update({"409", "503"})
                if method == "patch" or (method == "post" and "{" in path):
                    codes.update({"412", "428"})
                collection = path.rstrip("/").split("/")[-1]
                if method in {"get", "post", "patch"} and not hierarchy and not (method == "get" and "{" not in path):
                    success = "201" if method == "post" and collection in {"organizations", "sites", "domains", "modules", "site-templates"} else "200"
                    responses.setdefault(success, {}).setdefault("headers", {})["ETag"] = {
                        "description": "Strong representation validator. Echo exactly in If-Match for mutations.",
                        "schema": {"type": "string"},
                    }
                    if success == "201":
                        responses[success]["headers"]["Location"] = {
                            "description": "Created resource URL.", "schema": {"type": "string", "format": "uri-reference"},
                        }
            for code in sorted(codes):
                responses.setdefault(code, {
                    "description": descriptions[code],
                    "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/APIError"},
                    }},
                })
                if code in {"400", "401", "403"}:
                    names = {"400": "validation_error", "401": "not_authenticated", "403": "permission_denied"}
                    messages = {
                        "400": "The request is invalid.",
                        "401": "Authentication failed or credentials are missing.",
                        "403": "You do not have permission to perform this action.",
                    }
                    field = "name" if path.startswith("/api/v1/organizations/") else "title"
                    detail = {field: ["This field is required."]} if code == "400" else {"detail": messages[code]}
                    if code == "400" and method == "get" and path == "/api/v1/organizations/":
                        detail = {"status": ['"INVALID" is not a valid choice.']}
                    responses[code]["content"]["application/json"]["example"] = {
                        "error": {"code": names[code], "message": messages[code], "details": detail},
                        "request_id": "1ea47c51-f2d7-402b-ad9a-4df619d03055",
                    }
            for response in responses.values():
                response.setdefault("headers", {})["X-Request-ID"] = {
                    "description": "Correlation ID for this request.",
                    "schema": {"type": "string", "format": "uuid"},
                }
    return result
