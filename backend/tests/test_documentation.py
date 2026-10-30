"""Verify the generated contract and documentation's access boundary."""
import io
import os
import subprocess
import sys
import time
from uuid import UUID, uuid4

import pytest
import yaml
from django.core.management import call_command
from django.contrib.auth import get_user_model

DOC_URLS = ("/api/schema/", "/api/docs/", "/api/redoc/")


def test_production_default_disables_docs():
    environment = {**os.environ, "DEBUG": "False"}
    environment.pop("API_DOCS_ENABLED", None)
    subprocess.run(
        [sys.executable, "-c", "from config.settings import API_DOCS_ENABLED; assert API_DOCS_ENABLED is False"],
        env=environment, check=True,
    )


def test_self_hosted_assets_work_with_debug_false(client, settings):
    settings.DEBUG = False
    assert settings.STATIC_URL == "/api/static/"
    response = client.get("/api/static/drf_spectacular_sidecar/swagger-ui-dist/swagger-ui-bundle.js")
    assert response.status_code == 200
    assert "javascript" in response["Content-Type"]
    redoc = client.get("/api/static/drf_spectacular_sidecar/redoc/bundles/redoc.standalone.js")
    assert redoc.status_code == 200


def test_schema_validates_without_warnings_and_describes_live_contract():
    output = io.StringIO()
    call_command("spectacular", stdout=output, validate=True, fail_on_warn=True)
    schema = yaml.safe_load(output.getvalue())
    assert schema["openapi"] == "3.0.3"
    paths = schema["paths"]
    assert set(paths) == {
        "/api/pages/", "/api/pages/{id}/", "/api/pages/home/",
        "/api/me/", "/api/admin/overview/",
        "/api/v1/organizations/", "/api/v1/organizations/{id}/",
        "/api/v1/organizations/{id}/archive/", "/api/v1/organizations/{id}/deactivate/",
        "/api/v1/organizations/tree/", "/api/v1/organizations/{id}/children/",
        "/api/v1/organizations/{id}/ancestors/", "/api/v1/organizations/{id}/descendants/",
        "/api/v1/organizations/{id}/subtree/",
        "/api/v1/sites/", "/api/v1/sites/{id}/",
        "/api/v1/sites/{id}/activate/", "/api/v1/sites/{id}/suspend/",
        "/api/v1/sites/{id}/archive/", "/api/v1/sites/{id}/configuration/",
        "/api/v1/sites/{site_pk}/domains/", "/api/v1/sites/{site_pk}/domains/{id}/",
        "/api/v1/sites/{site_pk}/domains/{id}/activate/",
        "/api/v1/sites/{site_pk}/domains/{id}/deactivate/",
        "/api/v1/sites/{site_pk}/domains/{id}/set-primary/",
        "/api/v1/sites/{site_pk}/pages/",
        "/api/v1/sites/{site_pk}/pages/{id}/",
        "/api/v1/sites/{site_pk}/pages/{id}/workflow/",
        "/api/v1/sites/{site_pk}/modules/", "/api/v1/sites/{site_pk}/modules/{id}/",
        "/api/v1/sites/{site_pk}/modules/{id}/enable/",
        "/api/v1/sites/{site_pk}/modules/{id}/disable/",
        "/api/v1/cms/sites/{site_pk}/content-roles/",
        "/api/v1/cms/sites/{site_pk}/content-roles/{assignment_id}/",
        "/api/v1/cms/sites/{site_pk}/content/{content_id}/workflow/",
        "/api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/",
        "/api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/{revision_number}/",
        "/api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/{revision_number}/restore/",
        "/api/v1/site-templates/", "/api/v1/site-templates/{id}/",
        "/api/v1/modules/", "/api/v1/modules/{id}/",
        "/api/v1/site-context/",
        "/api/v1/site-context/pages/",
        "/api/v1/site-context/homepage/",
        "/api/v1/site-context/pages/{page_path}/",
    }
    assert paths["/api/me/"]["get"]["security"] == [{"keycloakBearer": []}]
    assert {} in paths["/api/pages/"]["get"]["security"]
    assert {} not in paths["/api/pages/"]["post"]["security"]
    assert paths["/api/me/"]["get"]["tags"] == ["Identity"]
    page_list = paths["/api/pages/"]["get"]
    assert page_list["tags"] == ["CMS"]
    assert any(p["name"] == "page" for p in page_list["parameters"])
    home = paths["/api/pages/home/"]["get"]
    assert not any(p["name"] == "page" for p in home["parameters"])
    assert home["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/Page")
    create = paths["/api/pages/"]["post"]
    assert create["requestBody"]["required"]
    assert {"201", "400", "401", "403", "415"} <= set(create["responses"])
    assert "X-Request-ID" in create["responses"]["400"]["headers"]
    assert schema["components"]["securitySchemes"]["keycloakBearer"]["scheme"] == "bearer"
    organizations = paths["/api/v1/organizations/"]
    discovery = organizations["get"]
    assert {"400", "404"} <= set(discovery["responses"])
    assert {"search", "name", "code", "type", "parent", "status", "ordering", "page"} <= {
        parameter["name"] for parameter in discovery["parameters"]
    }
    assert organizations["post"]["tags"] == ["Organizations"]
    assert organizations["post"]["security"] == [{"keycloakBearer": []}]
    assert {"ETag", "Location"} <= set(organizations["post"]["responses"]["201"]["headers"])
    patch = paths["/api/v1/organizations/{id}/"]["patch"]
    assert {"400", "401", "403", "404", "409", "412", "428", "503"} <= set(patch["responses"])
    assert any(p["name"] == "If-Match" and p["required"] for p in patch["parameters"])
    patch_fields = schema["components"]["schemas"]["PatchedOrganizationUpdateRequest"]["properties"]
    assert not {"id", "code", "status", "created_at", "updated_at"} & set(patch_fields)
    action = paths["/api/v1/organizations/{id}/archive/"]["post"]
    assert action["requestBody"]["content"]["application/json"]["schema"]["maxProperties"] == 0
    hierarchy_paths = ["/api/v1/organizations/tree/"] + [
        f"/api/v1/organizations/{{id}}/{relation}/"
        for relation in ["children", "ancestors", "descendants", "subtree"]
    ]
    for path in hierarchy_paths:
        operation = paths[path]["get"]
        assert operation["tags"] == ["Organizations"]
        assert operation["security"] == [{"keycloakBearer": []}]
        assert "409" in operation["responses"]
        assert not any(parameter["name"] == "page" for parameter in operation["parameters"])
        assert not any(parameter["name"] in {"search", "name", "code", "type", "parent", "status", "ordering"} for parameter in operation["parameters"])
        success = operation["responses"]["200"]
        assert success["content"]["application/json"]["schema"]["$ref"].endswith("/OrganizationHierarchy")
        assert "ETag" not in success["headers"]
    sites = paths["/api/v1/sites/"]
    assert sites["get"]["security"] == [{"keycloakBearer": []}]
    assert sites["post"]["tags"] == ["Sites"]
    assert {"search", "code", "status", "organization_unit", "ordering", "page"} <= {
        parameter["name"] for parameter in sites["get"]["parameters"]
    }
    assert {"ETag", "Location"} <= set(sites["post"]["responses"]["201"]["headers"])
    site_patch = paths["/api/v1/sites/{id}/"]["patch"]
    assert {"401", "403", "409", "412", "428"} <= set(site_patch["responses"])
    assert any(parameter["name"] == "If-Match" and parameter["required"] for parameter in site_patch["parameters"])
    activate = paths["/api/v1/sites/{id}/activate/"]["post"]
    assert activate["requestBody"]["content"]["application/json"]["schema"]["maxProperties"] == 0
    assert {"412", "428"} <= set(activate["responses"])
    assert paths["/api/v1/sites/{id}/configuration/"]["patch"]["tags"] == ["Sites"]
    domains = paths["/api/v1/sites/{site_pk}/domains/"]
    assert domains["get"]["tags"] == ["Domains"]
    assert "Location" in domains["post"]["responses"]["201"]["headers"]
    primary = paths["/api/v1/sites/{site_pk}/domains/{id}/set-primary/"]["post"]
    assert primary["tags"] == ["Domains"]
    assert {"409", "412", "428"} <= set(primary["responses"])
    assert paths["/api/v1/site-templates/"]["get"]["tags"] == ["Site templates"]
    assert paths["/api/v1/modules/"]["get"]["tags"] == ["Modules"]
    assert paths["/api/v1/sites/{site_pk}/modules/"]["post"]["tags"] == ["Sites"]
    role_assignments = paths["/api/v1/cms/sites/{site_pk}/content-roles/"]
    assert role_assignments["get"]["tags"] == ["CMS workflow"]
    assert role_assignments["post"]["security"] == [{"keycloakBearer": []}]
    role_input = role_assignments["post"]["requestBody"]["content"][
        "application/json"
    ]["schema"]["$ref"].rsplit("/", 1)[-1]
    role_fields = schema["components"]["schemas"][role_input]["properties"]
    assert set(role_fields) == {"user_id", "role"}
    workflow = paths["/api/v1/cms/sites/{site_pk}/content/{content_id}/workflow/"]["post"]
    assert workflow["tags"] == ["CMS workflow"]
    assert workflow["security"] == [{"keycloakBearer": []}]
    workflow_input = workflow["requestBody"]["content"]["application/json"][
        "schema"
    ]["$ref"].rsplit("/", 1)[-1]
    workflow_fields = schema["components"]["schemas"][workflow_input]["properties"]
    assert set(workflow_fields) == {"action", "comment"}
    assert "WorkflowContent" in schema["components"]["schemas"]
    revisions = paths[
        "/api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/"
    ]["get"]
    assert revisions["security"] == [{"keycloakBearer": []}]
    assert "ETag" in revisions["responses"]["200"]["headers"]
    restore = paths[
        "/api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/{revision_number}/restore/"
    ]["post"]
    assert restore["security"] == [{"keycloakBearer": []}]
    assert {"409", "428"} <= set(restore["responses"])
    assert "ETag" in restore["responses"]["200"]["headers"]
    assert any(
        parameter["name"] == "If-Match" and parameter["required"]
        for parameter in restore["parameters"]
    )
    assert "requestBody" not in restore
    context = paths["/api/v1/site-context/"]["get"]
    assert {} in context["security"]
    assert context["tags"] == ["Sites"]
    assert "post" not in paths["/api/v1/site-context/"]
    admin_pages = paths["/api/v1/sites/{site_pk}/pages/"]
    assert admin_pages["get"]["security"] == [{"keycloakBearer": []}]
    assert admin_pages["post"]["security"] == [{"keycloakBearer": []}]
    assert {"search", "status", "visibility", "locale", "parent", "ordering", "page", "page_size"} <= {
        parameter["name"] for parameter in admin_pages["get"]["parameters"]
    }
    page_patch = paths["/api/v1/sites/{site_pk}/pages/{id}/"]["patch"]
    assert {"409", "428"} <= set(page_patch["responses"])
    assert {"200", "409", "428"} <= set(page_patch["responses"])
    assert any(
        parameter["name"] == "If-Match" and parameter["required"]
        for parameter in page_patch["parameters"]
    )
    public_list = paths["/api/v1/site-context/pages/"]["get"]
    assert {} in public_list["security"]
    assert "site_id" not in {
        parameter["name"] for parameter in public_list["parameters"]
    }
    public_detail = paths["/api/v1/site-context/pages/{page_path}/"]["get"]
    assert {} in public_detail["security"]
    assert "308" in public_detail["responses"]
    assert {
        "ETag", "Cache-Control", "X-Publication-Version",
    } <= set(public_detail["responses"]["200"]["headers"])


@pytest.mark.parametrize("path", DOC_URLS)
def test_development_docs_are_public_and_not_cacheable(client, settings, path):
    settings.DEBUG = True
    settings.API_DOCS_ENABLED = True
    response = client.get(path)
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"
    UUID(response["X-Request-ID"])
    if path != "/api/schema/":
        html = response.content.decode()
        assert f"{settings.STATIC_URL}drf_spectacular_sidecar/" in html
        assert "cdn.jsdelivr.net" not in html
        assert "unpkg.com" not in html


@pytest.mark.parametrize("path", DOC_URLS)
def test_production_docs_disabled_even_for_staff(client, settings, path):
    settings.DEBUG = False
    settings.API_DOCS_ENABLED = False
    assert client.get(path).status_code == 404


@pytest.mark.django_db
@pytest.mark.parametrize("path", DOC_URLS)
def test_enabled_production_docs_require_staff_identity(client, settings, oidc, path):
    settings.DEBUG = False
    settings.API_DOCS_ENABLED = True
    assert client.get(path).status_code == 401
    assert client.get(path, **oidc.header(realm_access={"roles": ["platform-viewer"]})).status_code == 403
    assert client.get(path, **oidc.header()).status_code == 200
    assert client.get(path, **oidc.header(exp=int(time.time()) - 60)).status_code == 401
    settings.API_DOCS_ENABLED = False
    assert client.get(path, **oidc.header()).status_code == 404


@pytest.mark.django_db
def test_session_can_open_staff_docs_but_cannot_bypass_bearer_api_permissions(client, settings):
    settings.DEBUG = False
    settings.API_DOCS_ENABLED = True
    user = get_user_model().objects.create_user(username="docs-staff", is_staff=True)
    client.force_login(user)
    assert client.get("/api/docs/").status_code == 200
    assert client.get("/api/me/").status_code == 401
    assert client.get("/api/admin/overview/").status_code == 401


@pytest.mark.django_db
def test_validation_and_auth_errors_match_envelope_and_request_id(client, oidc):
    request_id = str(uuid4())
    response = client.post(
        "/api/pages/", {}, content_type="application/json",
        HTTP_X_REQUEST_ID=request_id, **oidc.header(),
    )
    assert response.status_code == 400
    assert response["X-Request-ID"] == request_id
    body = response.json()
    assert body["request_id"] == request_id
    assert body["error"]["code"] == "validation_error"
    assert "title" in body["error"]["details"]
    unauthenticated = client.get("/api/me/", HTTP_X_REQUEST_ID="untrusted-invalid-id")
    assert unauthenticated.status_code == 401
    assert unauthenticated["WWW-Authenticate"].startswith("Bearer")
    assert unauthenticated.json()["request_id"] == unauthenticated["X-Request-ID"]
    UUID(unauthenticated["X-Request-ID"])
