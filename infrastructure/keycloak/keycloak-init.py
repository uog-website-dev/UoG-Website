#!/usr/bin/env python3
"""
Keycloak bootstrap for the UoG development environment.

The realm itself is imported automatically from the version-controlled file
``realm-import/uog-realm.json`` when Keycloak starts with ``--import-realm``.
This script runs once afterwards and injects the values that must NEVER live
in git:

* client secrets for ``public-web``, ``admin-web`` and ``backend-api``
  (read from environment variables), and
* the development smoke-test user.

Because Keycloak never re-imports a realm that already exists, the script
also *reconciles* the parts of the realm that the platform depends on:

* the ``uog-api`` client scope, which puts the ``backend-api`` audience and
  the stable subject (``sub``) into every access token — without it the API
  cannot tell which audience a token was issued for, nor which Keycloak
  account it belongs to,
* the platform realm roles, and
* the ``platform-admin`` role of the development user.

It also performs the Keycloak connectivity smoke test (client-credentials and
password token grants) and verifies the shape of the issued access tokens.

Only stdlib is used so the script runs in the plain backend image.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

KC_URL = os.environ.get("KC_URL", "http://keycloak:8080").rstrip("/")
REALM = os.environ.get("KC_REALM", "uog")
ADMIN_USER = os.environ.get("KC_BOOTSTRAP_ADMIN_USERNAME", "uog_admin")
ADMIN_PASSWORD = os.environ.get("KC_BOOTSTRAP_ADMIN_PASSWORD", "")

CLIENT_SECRETS = {
    "public-web": os.environ.get("KEYCLOAK_PUBLIC_WEB_SECRET", ""),
    "admin-web": os.environ.get("KEYCLOAK_ADMIN_WEB_SECRET", ""),
    "backend-api": os.environ.get("KEYCLOAK_BACKEND_API_SECRET", ""),
}

# Client scope that makes an access token usable by the platform API.
API_CLIENT_SCOPE = "uog-api"
API_AUDIENCE = "backend-api"
API_SCOPE_CLIENTS = ("public-web", "admin-web", "backend-api")

# Realm roles owned by the identity provider; the API mirrors them as Django
# groups and uses them for role-based access control.
PLATFORM_ROLES = {
    "platform-admin": "Full administrative access to the platform.",
    "platform-editor": "May create and publish content.",
    "platform-viewer": "Read-only access to the administration console.",
}
DEV_ADMIN_ROLE = "platform-admin"

DEV_USERNAME = os.environ.get("KEYCLOAK_DEV_USERNAME", "devuser")
DEV_PASSWORD = os.environ.get("KEYCLOAK_DEV_PASSWORD", "")

READY_TIMEOUT_SECONDS = int(os.environ.get("KC_READY_TIMEOUT", "240"))


def log(message: str) -> None:
    print(f"==> {message}", flush=True)


def request(url: str, method: str = "GET", token: str | None = None, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:  # pragma: no cover - defensive
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {url} -> HTTP {exc.code}: {detail}") from exc


def request_optional(url: str, token: str):
    """GET that answers ``None`` instead of raising on 404."""
    try:
        return request(url, token=token)
    except RuntimeError as exc:
        if "-> HTTP 404" in str(exc):
            return None
        raise


def wait_for_keycloak() -> None:
    url = f"{KC_URL}/realms/master/.well-known/openid-configuration"
    deadline = time.time() + READY_TIMEOUT_SECONDS
    log(f"Waiting for Keycloak at {KC_URL} ...")
    while time.time() < deadline:
        try:
            request(url)
            log("Keycloak is up (OIDC discovery responding).")
            return
        except Exception:  # noqa: BLE001
            time.sleep(3)
    raise TimeoutError("Keycloak did not become ready in time")


def admin_token() -> str:
    payload = urllib.parse.urlencode(
        {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": ADMIN_USER,
            "password": ADMIN_PASSWORD,
        }
    ).encode()
    req = urllib.request.Request(
        f"{KC_URL}/realms/master/protocol/openid-connect/token", data=payload, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())["access_token"]


def find_client(token: str, client_id: str) -> dict:
    rows = request(
        f"{KC_URL}/admin/realms/{REALM}/clients?clientId={urllib.parse.quote(client_id)}",
        token=token,
    )
    if not rows:
        raise RuntimeError(
            f"Client '{client_id}' not found in realm '{REALM}' — was the realm imported?"
        )
    return rows[0]


def set_client_secret(token: str, client_id: str, secret: str) -> None:
    if not secret:
        raise RuntimeError(f"No secret provided in the environment for client '{client_id}'")
    summary = find_client(token, client_id)
    representation = request(
        f"{KC_URL}/admin/realms/{REALM}/clients/{summary['id']}", token=token
    )
    representation["secret"] = secret
    request(
        f"{KC_URL}/admin/realms/{REALM}/clients/{summary['id']}",
        method="PUT",
        token=token,
        body=representation,
    )
    log(f"Secret configured for client '{client_id}'.")


def find_client_scope(token: str, name: str) -> dict | None:
    scopes = request(f"{KC_URL}/admin/realms/{REALM}/client-scopes", token=token)
    return next((s for s in scopes if s.get("name") == name), None)


def ensure_api_client_scope(token: str) -> dict:
    """Make sure the ``uog-api`` client scope exists.

    The scope carries two protocol mappers:

    * an audience mapper, so access tokens state that they were issued for
      the platform API (``aud``), and
    * a subject mapper, so access tokens carry the stable Keycloak account
      identifier (``sub``). Keycloak 26 no longer adds ``sub`` to access
      tokens by default — it is a protocol mapper now.
    """
    existing = find_client_scope(token, API_CLIENT_SCOPE)

    mappers = [
        {
            "name": "uog-api-audience",
            "protocol": "openid-connect",
            "protocolMapper": "oidc-audience-mapper",
            "consentRequired": False,
            "config": {
                "included.client.audience": API_AUDIENCE,
                "id.token.claim": "false",
                "access.token.claim": "true",
                "introspection.token.claim": "true",
            },
        },
        {
            "name": "uog-api-subject",
            "protocol": "openid-connect",
            "protocolMapper": "oidc-sub-mapper",
            "consentRequired": False,
            "config": {
                "id.token.claim": "true",
                "access.token.claim": "true",
                "introspection.token.claim": "true",
            },
        },
    ]

    if existing is None:
        request(
            f"{KC_URL}/admin/realms/{REALM}/client-scopes",
            method="POST",
            token=token,
            body={
                "name": API_CLIENT_SCOPE,
                "description": (
                    "Audience and subject of the platform API, added to every access token."
                ),
                "protocol": "openid-connect",
                "attributes": {
                    "include.in.token.scope": "false",
                    "display.on.consent.screen": "false",
                },
                "protocolMappers": mappers,
            },
        )
        log(f"Client scope '{API_CLIENT_SCOPE}' created.")
        existing = find_client_scope(token, API_CLIENT_SCOPE)
        if existing is None:  # pragma: no cover - defensive
            raise RuntimeError(f"Client scope '{API_CLIENT_SCOPE}' was not created")

    # The scope exists — make sure it still carries both mappers.
    current = request(
        f"{KC_URL}/admin/realms/{REALM}/client-scopes/{existing['id']}/protocol-mappers/models",
        token=token,
    )
    by_name = {m.get("name"): m for m in current or []}
    for mapper in mappers:
        if mapper["name"] in by_name:
            continue
        request(
            f"{KC_URL}/admin/realms/{REALM}/client-scopes/{existing['id']}/protocol-mappers/models",
            method="POST",
            token=token,
            body=mapper,
        )
        log(f"Protocol mapper '{mapper['name']}' added to client scope '{API_CLIENT_SCOPE}'.")
    return existing


def ensure_scope_on_clients(token: str, scope: dict) -> None:
    """Assign the API client scope as a default scope of the platform clients.

    Keycloak only honours the default-scope assignment through the
    dedicated sub-resource — a full client update silently ignores it.
    """
    scope_id = scope["id"]
    for client_id in API_SCOPE_CLIENTS:
        summary = find_client(token, client_id)
        representation = request(
            f"{KC_URL}/admin/realms/{REALM}/clients/{summary['id']}", token=token
        )
        scopes = list(representation.get("defaultClientScopes") or [])
        if API_CLIENT_SCOPE in scopes or scope_id in scopes:
            continue
        request(
            f"{KC_URL}/admin/realms/{REALM}/clients/{summary['id']}"
            f"/default-client-scopes/{scope_id}",
            method="PUT",
            token=token,
        )
        log(f"Client scope '{API_CLIENT_SCOPE}' assigned to client '{client_id}'.")


def ensure_realm_roles(token: str) -> None:
    for name, description in PLATFORM_ROLES.items():
        if request_optional(f"{KC_URL}/admin/realms/{REALM}/roles/{name}", token) is not None:
            continue
        request(
            f"{KC_URL}/admin/realms/{REALM}/roles",
            method="POST",
            token=token,
            body={"name": name, "description": description},
        )
        log(f"Realm role '{name}' created.")


def ensure_dev_user(token: str) -> str:
    if not DEV_PASSWORD:
        raise RuntimeError("KEYCLOAK_DEV_PASSWORD is not set")
    rows = request(
        f"{KC_URL}/admin/realms/{REALM}/users?username={urllib.parse.quote(DEV_USERNAME)}",
        token=token,
    )
    rows = [row for row in rows if row.get("username") == DEV_USERNAME]
    if rows:
        user_id = rows[0]["id"]
        log(f"Development user '{DEV_USERNAME}' already exists — rotating password.")
    else:
        request(
            f"{KC_URL}/admin/realms/{REALM}/users",
            method="POST",
            token=token,
            body={
                "username": DEV_USERNAME,
                "enabled": True,
                "emailVerified": True,
                "email": f"{DEV_USERNAME}@uog.et",
                "firstName": "Development",
                "lastName": "User",
            },
        )
        # POST returns None; re-find the user.
        rows = request(
            f"{KC_URL}/admin/realms/{REALM}/users?username={urllib.parse.quote(DEV_USERNAME)}",
            token=token,
        )
        user_id = rows[0]["id"]
        log(f"Created development user '{DEV_USERNAME}' (id={user_id}).")
    request(
        f"{KC_URL}/admin/realms/{REALM}/users/{user_id}/reset-password",
        # Keycloak 26 expects PUT here; the former POST route answers 404.
        method="PUT",
        token=token,
        body={"type": "password", "value": DEV_PASSWORD, "temporary": False},
    )
    log(f"Password set for development user '{DEV_USERNAME}'.")
    return user_id


def ensure_dev_user_roles(token: str, user_id: str) -> None:
    """Give the development user the platform administrator role."""
    role = request_optional(f"{KC_URL}/admin/realms/{REALM}/roles/{DEV_ADMIN_ROLE}", token)
    if role is None:
        log(f"Realm role '{DEV_ADMIN_ROLE}' is missing — skipped.")
        return
    assigned = request(
        f"{KC_URL}/admin/realms/{REALM}/users/{user_id}/role-mappings/realm", token=token
    )
    if any(r.get("name") == DEV_ADMIN_ROLE for r in assigned or []):
        return
    request(
        f"{KC_URL}/admin/realms/{REALM}/users/{user_id}/role-mappings/realm",
        method="POST",
        token=token,
        body=[role],
    )
    log(f"Realm role '{DEV_ADMIN_ROLE}' assigned to '{DEV_USERNAME}'.")


def token_grant(params: dict) -> dict:
    payload = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        f"{KC_URL}/realms/{REALM}/protocol/openid-connect/token", data=payload, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def decode_claims(token: str) -> dict:
    """Decode the payload of a JWT without verifying it (local assertion only)."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def assert_api_token(token: str, label: str) -> None:
    """The platform API can only accept tokens that carry sub and the audience."""
    claims = decode_claims(token)
    audiences = claims.get("aud") or []
    if isinstance(audiences, str):
        audiences = [audiences]
    problems = []
    if not claims.get("sub"):
        problems.append("no 'sub' claim")
    if API_AUDIENCE not in audiences:
        problems.append(f"audience {audiences!r} does not include '{API_AUDIENCE}'")
    if problems:
        raise RuntimeError(f"{label}: access token is unusable by the API: {'; '.join(problems)}")
    log(f"Smoke test OK: {label} access token carries sub and the '{API_AUDIENCE}' audience.")


def smoke_test(token: str) -> None:
    log("Smoke test: client-credentials grant (backend-api) ...")
    body = token_grant(
        {
            "grant_type": "client_credentials",
            "client_id": "backend-api",
            "client_secret": CLIENT_SECRETS["backend-api"],
        }
    )
    assert body.get("access_token"), "no access token returned"
    assert_api_token(body["access_token"], "client-credentials")
    log("Smoke test OK: client-credentials grant issued a token.")

    log(f"Smoke test: password grant as '{DEV_USERNAME}' ...")
    body = token_grant(
        {
            "grant_type": "password",
            "client_id": "backend-api",
            "client_secret": CLIENT_SECRETS["backend-api"],
            "username": DEV_USERNAME,
            "password": DEV_PASSWORD,
        }
    )
    assert body.get("access_token"), "no access token returned"
    assert_api_token(body["access_token"], "password grant")
    log("Smoke test OK: development user authentication works.")


def main() -> int:
    wait_for_keycloak()
    token = admin_token()
    log("Authenticated to the Keycloak admin API.")
    for client_id, secret in CLIENT_SECRETS.items():
        set_client_secret(token, client_id, secret)
    api_scope = ensure_api_client_scope(token)
    ensure_scope_on_clients(token, api_scope)
    ensure_realm_roles(token)
    user_id = ensure_dev_user(token)
    ensure_dev_user_roles(token, user_id)
    smoke_test(token)
    log("Keycloak bootstrap complete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
