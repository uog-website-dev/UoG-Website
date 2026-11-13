"""VISUAL_BUILDER is a Site module like Pages/Posts/Menus and depends on PAGES."""
import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, ModuleDependency, Site
from apps.sites.selectors.modules import module_is_available, usable_modules
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def sites():
    call_command("seed_rbac", verbosity=0)
    kind, _ = OrganizationType.objects.get_or_create(
        code="UNIVERSITY", defaults={"name": "University"},
    )
    owner = OrganizationUnit.objects.create(
        code="VB-UOG", name="Builder University", organization_type=kind,
    )
    a = Site.objects.create(organization_unit=owner, code="VB-A", name="Informatics")
    b = Site.objects.create(organization_unit=owner, code="VB-B", name="Medicine")
    return a, b


def test_visual_builder_is_shipped_requires_pages_and_is_site_scoped(sites):
    a, b = sites
    pages = Module.objects.get(code="PAGES")
    builder = Module.objects.get(code="VISUAL_BUILDER")
    assert builder.status == "IMPLEMENTED" and builder.is_enabled is True
    assert builder in usable_modules()
    assert ModuleDependency.objects.filter(module=builder, requires=pages).exists()

    with pytest.raises(ValidationError, match="PAGES"):
        enable_module_for_site(a.pk, builder.pk)

    enable_module_for_site(a.pk, pages.pk)
    enable_module_for_site(a.pk, builder.pk)
    assert module_is_available(a.pk, "VISUAL_BUILDER")
    assert not module_is_available(b.pk, "VISUAL_BUILDER")

    with pytest.raises(ValidationError, match="VISUAL_BUILDER"):
        disable_module_for_site(a.pk, pages.pk)

    disable_module_for_site(a.pk, builder.pk)
    assert not module_is_available(a.pk, "VISUAL_BUILDER")
    disable_module_for_site(a.pk, pages.pk)
