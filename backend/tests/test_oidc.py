"""
Unit tests for the Keycloak access-token validation.

These tests do not touch the database or the network — they exercise the
signature, issuer, audience and client checks in isolation.
"""
import base64
import json
import time

import jwt
import pytest

from apps.accounts.oidc import (
    IdentityProviderUnavailable,
    JWKSCache,
    OIDCConfig,
    TokenValidationError,
    validate_access_token,
)

from .oidc_helpers import (
    AUDIENCE,
    ISSUER,
    JWKS_URL,
    KEY_ID,
    generate_signing_key,
    jwks_cache,
    jwks_document,
    make_token,
)


@pytest.fixture(scope="module")
def signing_key():
    return generate_signing_key()


@pytest.fixture
def config():
    return OIDCConfig(
        issuer=ISSUER,
        jwks_url=JWKS_URL,
        audiences=(AUDIENCE,),
        allowed_clients=("public-web", "admin-web"),
    )


@pytest.fixture
def jwks(signing_key):
    return jwks_cache(signing_key)


def test_valid_token_is_accepted(signing_key, config, jwks):
    claims = validate_access_token(make_token(signing_key), config, jwks)
    assert claims.subject == "5f1b2c3d-0000-4000-8000-000000000001"
    assert claims.issuer == ISSUER
    assert claims.client_id == "public-web"
    assert claims.username == "devuser"
    assert claims.email == "devuser@uog.et"
    assert claims.realm_roles == ("platform-admin", "default-roles-uog")
    assert "platform-admin" in claims.roles
    assert claims.scopes == ("email", "profile")


def test_expired_token_is_rejected(signing_key, config, jwks):
    token = make_token(signing_key, exp=int(time.time()) - 60)
    with pytest.raises(TokenValidationError, match="expired"):
        validate_access_token(token, config, jwks)


def test_token_from_another_issuer_is_rejected(signing_key, config, jwks):
    token = make_token(signing_key, iss="https://evil.test/realms/uog")
    with pytest.raises(TokenValidationError, match="another identity provider"):
        validate_access_token(token, config, jwks)


def test_token_for_another_audience_is_rejected(signing_key, config, jwks):
    token = make_token(signing_key, aud="account")
    with pytest.raises(TokenValidationError, match="not issued for this API"):
        validate_access_token(token, config, jwks)


def test_token_without_audience_is_rejected(signing_key, config, jwks):
    token = make_token(signing_key)
    # Rebuild the token without the audience claim.
    token = jwt.encode(
        {
            "iss": ISSUER,
            "sub": "x",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        signing_key,
        algorithm="RS256",
        headers={"kid": "test-key-id"},
    )
    with pytest.raises(TokenValidationError, match="no audience"):
        validate_access_token(token, config, jwks)


def test_token_for_an_unexpected_client_is_rejected(signing_key, config, jwks):
    token = make_token(signing_key, azp="some-other-app")
    with pytest.raises(TokenValidationError, match="unexpected client"):
        validate_access_token(token, config, jwks)


def test_token_without_subject_is_rejected(signing_key, config, jwks):
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "azp": "public-web",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        signing_key,
        algorithm="RS256",
        headers={"kid": "test-key-id"},
    )
    with pytest.raises(TokenValidationError, match="missing the 'sub' claim"):
        validate_access_token(token, config, jwks)


def test_token_signed_with_another_key_is_rejected(signing_key, config, jwks):
    other_key = generate_signing_key()
    token = make_token(other_key)
    with pytest.raises(TokenValidationError, match="invalid"):
        validate_access_token(token, config, jwks)


def test_token_with_an_unknown_key_id_is_rejected(signing_key, config, jwks):
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": "x",
            "azp": "public-web",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        signing_key,
        algorithm="RS256",
        headers={"kid": "rotated-away"},
    )
    with pytest.raises(TokenValidationError, match="unknown key"):
        validate_access_token(token, config, jwks)


def test_symmetric_algorithm_is_rejected(signing_key, config, jwks):
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": "x",
            "azp": "public-web",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        "a-shared-secret-that-is-long-enough-32",
        algorithm="HS256",
        headers={"kid": "test-key-id"},
    )
    with pytest.raises(TokenValidationError, match="unsupported algorithm"):
        validate_access_token(token, config, jwks)


def test_garbage_token_is_rejected(config, jwks):
    with pytest.raises(TokenValidationError, match="not a readable JWT"):
        validate_access_token("not-a-jwt", config, jwks)


def test_unsigned_token_is_rejected(config, jwks):
    """An `alg: none` token with valid claims must never be accepted."""
    now = int(time.time())

    def segment(claim_set: dict) -> str:
        raw = json.dumps(claim_set, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    header = {"alg": "none", "typ": "JWT", "kid": KEY_ID}
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "5f1b2c3d-0000-4000-8000-000000000001",
        "azp": "public-web",
        "iat": now,
        "exp": now + 60,
    }
    token = f"{segment(header)}.{segment(claims)}."

    with pytest.raises(TokenValidationError, match="unsupported algorithm"):
        validate_access_token(token, config, jwks)


def test_empty_token_is_rejected(config, jwks):
    with pytest.raises(TokenValidationError, match="no access token"):
        validate_access_token("   ", config, jwks)


def test_unreachable_identity_provider_is_reported(config):
    cache = JWKSCache(
        config.jwks_url,
        fetcher=lambda url, timeout: (_ for _ in ()).throw(OSError("connection refused")),
    )
    with pytest.raises(IdentityProviderUnavailable):
        validate_access_token(make_token(generate_signing_key()), config, cache)


def test_signing_keys_are_cached(signing_key, config):
    calls = []

    def fetcher(url, timeout):
        calls.append(url)
        return jwks_document(signing_key)

    cache = JWKSCache(config.jwks_url, fetcher=fetcher)
    validate_access_token(make_token(signing_key), config, cache)
    validate_access_token(make_token(signing_key), config, cache)
    assert len(calls) == 1


def test_rotated_signing_key_is_picked_up(signing_key, config):
    """A token signed with a new key must work after a key rotation."""
    documents = [jwks_document(signing_key)]

    def fetcher(url, timeout):
        return documents[0]

    cache = JWKSCache(config.jwks_url, fetcher=fetcher)
    validate_access_token(make_token(signing_key), config, cache)

    rotated_key = generate_signing_key()
    rotated = jwt.algorithms.RSAAlgorithm.to_jwk(rotated_key.public_key())
    import json as _json

    rotated = _json.loads(rotated)
    rotated.update({"kid": "rotated-key", "alg": "RS256", "use": "sig"})
    documents[0] = {"keys": [rotated]}

    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": "x",
            "azp": "public-web",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        rotated_key,
        algorithm="RS256",
        headers={"kid": "rotated-key"},
    )
    claims = validate_access_token(token, config, cache)
    assert claims.subject == "x"
