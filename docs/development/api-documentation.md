# Django API documentation

The OpenAPI 3.0.3 document is generated from the registered DRF views and
serializers on every schema request. Swagger and ReDoc load local assets
from the pinned `drf-spectacular-sidecar` package; no CDN is required.

| URL | Purpose |
| --- | --- |
| `/api/schema/` | OpenAPI YAML; append `?format=json` for JSON |
| `/api/docs/` | Swagger UI with interactive requests |
| `/api/redoc/` | ReDoc reference |

In the Docker development environment use `http://localhost/api/docs/`,
or the backend directly at `http://localhost:8000/api/docs/`.
After pulling these changes, rebuild the backend image to install dependencies.
For a local virtual environment install `backend/requirements/dev.txt`.
Production images collect static assets during build and WhiteNoise serves
them with `DEBUG=False`. Swagger and ReDoc assets are published at
`/api/static/`, which the API proxy already forwards to Django.

## Authentication and local testing

Use the existing development Keycloak realm and clients. Run
`docker compose up -d --build` and ensure `keycloak-init` completes.
From the repository root:

```console
python scripts/dev-api-token.py
```

This standard-library helper prompts for the development client secret,
username and password. Use credentials from your local development setup
(`.env.example` documents the default setup); secrets are not saved. It
requests `openid profile email` and prints a short-lived access token.
It only accepts loopback identity-provider URLs. `OIDC_ISSUER` can select a
different local port and `KEYCLOAK_BACKEND_API_SECRET` can supply the client
secret from the environment. This uses the existing local direct-grant
client; it is not a production OAuth workflow or a new public token endpoint.

1. Open Swagger and select **Authorize** → **keycloakBearer**.
2. Paste only the JWT, without the `Bearer` prefix; authorize and close.
3. Execute `GET /api/me/` to inspect identity and roles.
4. Execute `GET /api/admin/overview/` with a user carrying `platform-admin`.
   A viewer token must receive 403. Missing/expired/invalid tokens receive 401.
5. Test Pages writes with a valid token and the documented JSON request.
   Writes affect the development database. Clear authorization when finished.

Swagger does not persist the token across reloads. It sends the normal
Authorization header; backend signature, issuer, audience, authorized-client,
expiry, provisioning and permission checks all apply. Identity endpoints
require a bearer token: a staff browser session alone does not authorize them.
The docs may be opened using an existing Django staff session when permitted;
that session does not supply Keycloak roles for testing API operations.

## Endpoint coverage and scope

Current operations are **CMS** (`/api/pages/`, `/api/pages/{id}/`,
`/api/pages/home/`) and **Identity** (`/api/me/`, `/api/admin/overview/`).
Organizations administration is available at `/api/v1/organizations/`, grouped
under Organizations. All operations require a verified `platform-admin`
bearer token; writes additionally require explicit development opt-in and
are disabled with DEBUG=False pending scoped IAM/RBAC. See the
[contract and conditional mutation workflow](../api/organizations.md) and
[error catalog](../api/error-catalog.md). Site, Domain, Posts and Menus APIs
remain absent; their tags reserve vocabulary for later implementation.

Pages currently use a shared platform queryset. Reads expose published pages;
writes require authentication. Responses use page-number pagination with
`page`, 20 rows per page, and newest `created_at` first. There are no search,
filter, client-controlled sort or page-size parameters. Unknown query
parameters do not implement these features. `home` returns a single object
and the existing GET seeds a page when none exists.

Before adding a scoped API, its story must define the approved organization/
site identifier transport, membership and permission checks, and activation
source and failure status. Then enforce scoping in selectors/querysets and
write services, including lookup, list, create, update, delete and linked
objects. Validate that the requested module is active for the resolved Site.
No caller-supplied header or object ID is authorization. Add negative tests
for cross-Site access and inactive modules and document the implemented
parameters/status codes. These are integration requirements for future APIs;
this change cannot verify cross-Site isolation or activation for absent APIs.

## Errors and request correlation

Handled DRF failures now use the following shared envelope (this replaces
DRF's former top-level field errors/`detail`; successful responses are unchanged):

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid.",
    "details": {"title": ["This field is required."]}
  },
  "request_id": "1ea47c51-f2d7-402b-ad9a-4df619d03055"
}
```

The schema describes this as `APIError`. `details` retains DRF's field
messages or detail object. 401 preserves `WWW-Authenticate`; 403 preserves
permission enforcement. Other common codes include `not_found`,
`method_not_allowed`, `not_acceptable`, and `unsupported_media_type`.
Unhandled server exceptions and Django URL-resolution failures retain
Django's error handling; they are not claimed to follow the DRF envelope.

Every Django response includes `X-Request-ID`. A supplied UUID is normalized
and echoed; missing or invalid IDs are replaced. DRF error bodies carry the
same ID. CORS allows and exposes this header for frontend consumers.

## Documentation access

| Configuration | All three documentation views |
| --- | --- |
| `API_DOCS_ENABLED=False` | Disabled (404 for normal requests) |
| `API_DOCS_ENABLED=True`, `DEBUG=True` | Public development documentation |
| `API_DOCS_ENABLED=True`, `DEBUG=False` | Active authenticated staff only |

In Django settings `API_DOCS_ENABLED` defaults to `DEBUG`. The production
Compose file explicitly defaults it to False. Enable production staff access
only when authorized for that deployment. Both bearer and existing Django
staff session authentication are supported for reading docs. The schema and
HTML responses are `private, no-store`; bundled static assets contain no API
credentials or schema and may be served publicly. Do not expose a development
deployment with `DEBUG=True` as production.

## Keeping the schema current and CI

Use serializer classes and querysets on new viewsets, add a domain tag with
`extend_schema`, and annotate APIView responses, custom actions, examples,
special status codes, filters and scope/activation checks. Introspection
tracks serializer field and route changes automatically. Update explicit
annotations when non-inferable behavior changes.

```console
docker compose exec backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
docker compose exec backend pytest
```

Azure's backend job runs schema generation/validation with warnings treated
as failures after the tests, then publishes `openapi-schema`. Documentation
routes are excluded from the generated operation list. Do not hand-edit a
generated schema. The repository snapshot is [docs/api/openapi.yaml](../api/openapi.yaml).
Regenerate it using the command above and copy `/tmp/openapi.yaml` from the
backend container into that repository path with `docker compose cp`.
CI compares the parsed generated schema with the snapshot and publishes the
validated `openapi-schema` artifact; contract changes must update the snapshot.

Implementation references: [drf-spectacular customization](https://drf-spectacular.readthedocs.io/en/stable/customization.html),
[self-hosted assets](https://pypi.org/project/drf-spectacular-sidecar/), and
[WhiteNoise deployment](https://whitenoise.readthedocs.io/en/stable/django.html).

## Implementation verification (2026-10-23)

- Backend Docker environment: `64 passed in 16.52s` against PostgreSQL.
  Includes documentation access with anonymous, viewer, staff and expired
  tokens; session isolation; DEBUG=False assets; schema validation; error
  envelope and correlation IDs; existing platform and organization tests.
- `spectacular --validate --fail-on-warn`: exit 0; nine operations across
  five live API paths. `manage.py check` and migration drift checks pass.
- Swagger/ReDoc and local static assets return HTTP 200 through Nginx.
  Isolated headless Chrome renders Swagger's nine operations and the ReDoc
  reference successfully. No external asset CDN is needed.
- A real local Keycloak development token with `openid profile email`
  successfully calls both identity operations through Nginx (HTTP 200,
  correlation headers present); tokens were not included in test output.
- CI generation, validation and artifact publication are configured;
  a hosted Azure pipeline run has not been triggered or verified here.
- Organization/Site/Domain operations and cross-Site/activation checks
  remain dependent on implementing those APIs.
