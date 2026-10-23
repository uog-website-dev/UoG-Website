"""
Helpers that mint Keycloak-style access tokens for the test suite.

The tests never talk to a real identity provider: a throw-away RSA key pair
is generated, published as a JWKS document and used to sign tokens that
carry the same claims Keycloak issues.
"""
import json
import time

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from apps.accounts.oidc import JWKSCache

ISSUER = "http://localhost:8080/realms/uog"
AUDIENCE = "backend-api"
KEY_ID = "test-key-id"
JWKS_URL = "https://idp.test/realms/uog/protocol/openid-connect/certs"


def generate_signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def jwks_document(private_key: rsa.RSAPrivateKey) -> dict:
    """The public JWKS document of the given signing key."""
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": KEY_ID, "alg": "RS256", "use": "sig"})
    return {"keys": [jwk]}


def make_token(private_key: rsa.RSAPrivateKey, **overrides) -> str:
    """A signed access token; keyword arguments override single claims."""
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "5f1b2c3d-0000-4000-8000-000000000001",
        "azp": "public-web",
        "typ": "Bearer",
        "preferred_username": "devuser",
        "email": "devuser@uog.et",
        "email_verified": True,
        "name": "Development User",
        "given_name": "Development",
        "family_name": "User",
        "realm_access": {"roles": ["platform-admin", "default-roles-uog"]},
        "resource_access": {},
        "scope": "email profile",
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    return jwt.encode(
        claims, private_key, algorithm="RS256", headers={"kid": KEY_ID}
    )


def jwks_cache(private_key: rsa.RSAPrivateKey) -> JWKSCache:
    """A JWKS cache that serves the test key without any network access."""
    document = jwks_document(private_key)
    return JWKSCache(JWKS_URL, fetcher=lambda url, timeout: document)
