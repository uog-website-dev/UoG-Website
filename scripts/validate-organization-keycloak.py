"""Read-only live dev smoke plus denied-write checks; never print credentials.

Run in the existing keycloak-init service environment (see readiness report).
No realm configuration, roles, passwords or Organization records are changed.
The backend's normal OIDC provisioning may refresh the development principal.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from uuid import UUID, uuid4


def exchange(url, *, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def main():
    issuer_url = os.environ.get("KC_URL", "http://keycloak:8080").rstrip("/")
    if urllib.parse.urlparse(issuer_url).hostname not in {"keycloak", "localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("This development smoke only supports the local identity provider.")
    realm = os.environ.get("KC_REALM", "uog")
    grant = urllib.parse.urlencode({
        "grant_type": "password", "client_id": "backend-api",
        "client_secret": os.environ["KEYCLOAK_BACKEND_API_SECRET"],
        "username": os.environ["KEYCLOAK_DEV_USERNAME"],
        "password": os.environ["KEYCLOAK_DEV_PASSWORD"],
        "scope": "openid profile email",
    }).encode()
    status, _, body = exchange(f"{issuer_url}/realms/{realm}/protocol/openid-connect/token", data=grant)
    if status != 200:
        raise RuntimeError(f"Development Keycloak token exchange returned {status}; credentials were not printed.")
    token = json.loads(body)["access_token"]
    print("Development Keycloak token exchange: 200 (credentials and token omitted)")
    base = "http://nginx"
    request_id = str(uuid4())
    headers = {"Host": "localhost", "Authorization": f"Bearer {token}", "X-Request-ID": request_id}
    for path in ["/api/me/", "/api/v1/organizations/", "/api/v1/organizations/tree/", "/api/v1/organizations/?search=informatics&type=COLLEGE&status=ACTIVE"]:
        status, response_headers, body = exchange(base + path, headers=headers)
        if status != 200:
            raise RuntimeError(f"Authenticated {path} returned {status}.")
        UUID(response_headers["X-Request-ID"])
        if response_headers["X-Request-ID"] != request_id:
            raise RuntimeError("Correlation ID was not preserved.")
        if path == "/api/me/" and "platform-admin" not in json.loads(body)["roles"]:
            raise RuntimeError("Development identity lacks the approved administrator role.")
        print(f"Authenticated GET {path}: 200; correlation ID preserved")
    status, _, _ = exchange(base + "/api/v1/organizations/tree/", headers={"Host": "localhost"})
    if status != 401:
        raise RuntimeError(f"Anonymous tree request returned {status}, expected 401.")
    print("Anonymous hierarchy access: 401")
    status, _, _ = exchange(base + "/api/v1/organizations/", headers={"Host": "localhost", "Authorization": "Bearer invalid-token"})
    if status != 401:
        raise RuntimeError(f"Invalid bearer returned {status}, expected 401.")
    print("Invalid bearer access: 401")
    status, _, body = exchange(base + "/api/v1/organizations/", data=b"{}", headers={**headers, "Content-Type": "application/json"})
    if status != 403:
        raise RuntimeError(f"Expected development writes to remain disabled (403); received {status}.")
    if json.loads(body)["error"]["code"] != "permission_denied":
        raise RuntimeError("Denied write did not use the standard envelope.")
    print("Authenticated write with normal development opt-in disabled: 403; no Organization created")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, RuntimeError, urllib.error.URLError) as error:
        # Exception messages above deliberately omit response/token bodies.
        print(f"Organization live smoke failed: {error}", file=sys.stderr)
        sys.exit(1)
