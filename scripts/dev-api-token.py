"""Obtain a short-lived token for local Swagger testing; no secrets are saved.

Uses the existing development-only Keycloak direct grant. Never enable that
grant for a production Swagger client; use the organization's approved OIDC
flow there. This helper deliberately refuses non-loopback identity providers.
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    issuer = os.environ.get("OIDC_ISSUER", "http://localhost:8080/realms/uog").rstrip("/")
    parsed = urllib.parse.urlparse(issuer)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.scheme not in {"http", "https"}:
        sys.exit("This development helper only accepts a loopback OIDC_ISSUER.")
    client_id = os.environ.get("KEYCLOAK_TEST_CLIENT_ID", "backend-api")
    secret = os.environ.get("KEYCLOAK_BACKEND_API_SECRET") or getpass.getpass("Development client secret: ")
    username = input("Development username [devuser]: ").strip() or "devuser"
    password = getpass.getpass("Development password: ")
    body = urllib.parse.urlencode({
        "grant_type": "password", "client_id": client_id, "client_secret": secret,
        "username": username, "password": password, "scope": "openid profile email",
    }).encode()
    request = urllib.request.Request(issuer + "/protocol/openid-connect/token", data=body)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except (urllib.error.URLError, ValueError):
        sys.exit("Token request failed. Check local Keycloak, client setup and development credentials.")
    print(payload["access_token"])


if __name__ == "__main__":
    main()
