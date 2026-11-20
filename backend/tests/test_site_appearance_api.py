"""Site Appearance configuration stays Site scoped and RBAC protected."""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from apps.authorization.models import Role, UserRoleAssignment
from apps.media.models import MediaAsset
from apps.media.services import _media_write_session
from apps.sites.configuration import default_configuration
from apps.sites.models import Site, SiteTemplate

pytestmark = pytest.mark.django_db

SITES = "/api/v1/sites/"
TEMPLATES = "/api/v1/site-templates/"


@pytest.fixture
def owner():
    from apps.organizations.models import OrganizationType, OrganizationUnit

    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="APPEARANCE-UOG", name="University", organization_type=university)
    return OrganizationUnit.objects.create(
        code="APPEARANCE-CI", name="Informatics", organization_type=college, parent=root,
    )


def _ready_logo(site, user):
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=f"platform-private:sites/{site.pk}/logo/{uuid.uuid4()}",
            original_filename="approved-logo.png",
            detected_mime="image/png",
            byte_count=128,
            checksum="a" * 64,
            status="PENDING",
            width=64,
            height=64,
            created_by=user,
            updated_by=user,
        )
        asset.status = "READY"
        asset.save(update_fields=("status",))
    return asset


def _site_admin_client(client, oidc, site):
    call_command("seed_rbac", verbosity=0)
    subject = f"site-appearance-{uuid.uuid4()}"
    client.defaults.update(oidc.header(
        sub=subject,
        preferred_username=subject,
        email=f"{subject}@uog.et",
        realm_access={"roles": ["platform-viewer"]},
    ))
    assert client.get("/api/me/").status_code == 200
    user = get_user_model().objects.get(username=subject)
    UserRoleAssignment.objects.create(
        user=user,
        role=Role.objects.get(code="site-administrator"),
        scope=UserRoleAssignment.Scope.SITE,
        site=site,
        organization=site.organization_unit,
    )
    return user


def test_site_admin_appearance_api_save_isolated_and_cannot_edit_global_defaults(
    client, oidc, owner, settings,
):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="APPEARANCE-A", name="Site A", organization_unit=owner)
    site_b = Site.objects.create(code="APPEARANCE-B", name="Site B", organization_unit=owner)
    user = _site_admin_client(client, oidc, site_a)
    logo = _ready_logo(site_a, user)

    site_url = f"{SITES}{site_a.pk}/"
    current = client.get(site_url)
    assert current.status_code == 200
    with patch("apps.sites.services.configuration.module_is_available", return_value=True):
        saved = client.patch(
            site_url + "configuration/",
            {
                "identity": {"display_name": "Site A public title", "logo_ref": logo.pk.hex},
                "presentation": {"theme": "high-contrast"},
            },
            content_type="application/json",
            HTTP_IF_MATCH=current["ETag"],
        )
    assert saved.status_code == 200, saved.content
    saved_config = saved.json()["configuration"]
    assert saved_config["identity"]["display_name"] == "Site A public title"
    assert saved_config["identity"]["logo_ref"] == logo.pk.hex
    assert saved_config["presentation"]["theme"] == "high-contrast"
    reopened = client.get(site_url)
    assert reopened.status_code == 200
    assert reopened.json()["configuration"] == saved_config
    assert reopened["ETag"]

    site_b.refresh_from_db()
    assert site_b.configuration == default_configuration("en-us")
    assert client.patch(
        f"{SITES}{site_b.pk}/configuration/",
        {"identity": {"display_name": "Cross-Site write"}},
        content_type="application/json",
        HTTP_IF_MATCH='"irrelevant"',
    ).status_code == 403

    template = SiteTemplate.objects.create(
        code="APPEARANCE_GLOBAL",
        name="Global appearance fixture",
        description="Used to check platform-default authorization.",
        default_configuration=default_configuration("en-us"),
    )
    assert client.patch(
        f"{TEMPLATES}{template.pk}/",
        {"default_configuration": {"presentation": {"theme": "high-contrast"}}},
        content_type="application/json",
        HTTP_IF_MATCH='"irrelevant"',
    ).status_code == 403

    latest = client.get(site_url)
    for invalid in (
        {"presentation": {"theme": "custom-css"}},
        {"presentation": {"primary_color": "not-a-color"}},
        {"presentation": {"custom_css": "body { display:none }"}},
        {"presentation": {"custom_js": "alert(1)"}},
        {"identity": {"logo_ref": "https://private.example/logo.png"}},
    ):
        rejected = client.patch(
            site_url + "configuration/",
            invalid,
            content_type="application/json",
            HTTP_IF_MATCH=latest["ETag"],
        )
        assert rejected.status_code == 400, (invalid, rejected.content)

    site_a.refresh_from_db()
    site_b.refresh_from_db()
    assert site_a.configuration["identity"]["logo_ref"] == logo.pk.hex
    assert site_a.configuration["presentation"]["theme"] == "high-contrast"
    assert site_b.configuration == default_configuration("en-us")
