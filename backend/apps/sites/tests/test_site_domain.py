"""Site hostnames: normalization, one primary, and resolution."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connections, transaction

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.hostnames import normalize_hostname
from apps.sites.models import Site, SiteDomain
from apps.sites.selectors.domains import resolve_hostname
from apps.sites.services.domains import activate_domain, deactivate_domain, designate_primary, reassign_domain
from apps.sites.services.lifecycle import activate_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def sites():
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    medicine = OrganizationUnit.objects.create(code="CM", name="College of Medicine", organization_type=college, parent=root)
    first = Site.objects.create(organization_unit=informatics, code="INFORMATICS", name="Informatics")
    second = Site.objects.create(organization_unit=medicine, code="MEDICINE", name="Medicine")
    activate_site(first.pk)
    activate_site(second.pk)
    return first, second


def test_hostname_normalization_strips_case_dot_and_default_port():
    assert normalize_hostname(" INFORMATICS.UOG.EDU.ET. ") == "informatics.uog.edu.et"
    assert normalize_hostname("informatics.uog.edu.et:443") == "informatics.uog.edu.et"
    assert normalize_hostname("Bücher.uog.edu.et") == "xn--bcher-kva.uog.edu.et"


@pytest.mark.parametrize("value", ["https://informatics.uog.edu.et/about", "informatics.uog.edu.et/path", "user@informatics.uog.edu.et", "informatics.uog.edu.et:8443", "localhost", "", "bad_host.uog.edu.et"])
def test_invalid_hostnames_are_rejected(sites, value):
    with pytest.raises(ValidationError):
        SiteDomain.objects.create(site=sites[0], hostname=value)


def test_multiple_domains_one_primary_and_duplicate_hostname_rejected(sites):
    primary = SiteDomain.objects.create(site=sites[0], hostname="informatics.uog.edu.et", is_primary=True, status="ACTIVE")
    alias = SiteDomain.objects.create(site=sites[0], hostname="computing.uog.edu.et", redirect_to_primary=True, status="ACTIVE")
    assert list(sites[0].domains.values_list("hostname", flat=True)) == ["computing.uog.edu.et", "informatics.uog.edu.et"]
    assert primary.site_id == alias.site_id == sites[0].pk
    with pytest.raises(ValidationError):
        SiteDomain.objects.create(site=sites[1], hostname="INFORMATICS.UOG.EDU.ET")
    with pytest.raises(ValidationError):
        SiteDomain.objects.create(site=sites[0], hostname="portal.uog.edu.et", is_primary=True)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteDomain.objects.filter(pk=alias.pk).update(is_primary=True)
    assert SiteDomain.objects.filter(site=sites[0], is_primary=True).count() == 1


def test_primary_switch_redirect_resolution_and_deactivation(sites):
    primary = SiteDomain.objects.create(site=sites[0], hostname="informatics.uog.edu.et", is_primary=True, status="ACTIVE")
    alias = SiteDomain.objects.create(site=sites[0], hostname="computing.uog.edu.et", redirect_to_primary=True, status="ACTIVE")
    resolved = resolve_hostname("Computing.UoG.edu.et:80")
    assert resolved["site"] == sites[0]
    assert resolved["redirect_hostname"] == "informatics.uog.edu.et"
    assert resolve_hostname("informatics.uog.edu.et")["redirect_hostname"] is None
    designate_primary(alias.pk)
    alias.refresh_from_db()
    primary.refresh_from_db()
    assert alias.is_primary and not alias.redirect_to_primary
    assert not primary.is_primary
    deactivate_domain(alias.pk)
    assert resolve_hostname("computing.uog.edu.et") is None
    assert activate_domain(alias.pk).status == "ACTIVE"


def test_inactive_domain_and_direct_reassignment_do_not_resolve_or_move(sites):
    domain = SiteDomain.objects.create(site=sites[0], hostname="computing.uog.edu.et", status="INACTIVE")
    assert resolve_hostname("computing.uog.edu.et") is None
    domain.site = sites[1]
    with pytest.raises(ValidationError):
        domain.save()
    domain.refresh_from_db()
    assert domain.site_id == sites[0].pk
    moved = reassign_domain(domain.pk, sites[1].pk)
    assert moved.site_id == sites[1].pk
    primary = SiteDomain.objects.create(site=sites[0], hostname="informatics.uog.edu.et", is_primary=True)
    with pytest.raises(ValidationError):
        reassign_domain(primary.pk, sites[1].pk)


def test_database_rejects_unnormalized_bulk_hostname(sites):
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteDomain.objects.bulk_create([SiteDomain(site=sites[0], hostname="INFORMATICS.UOG.EDU.ET")])
    assert not SiteDomain.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_primary_updates_leave_one_primary():
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    unit = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    site = Site.objects.create(organization_unit=unit, code="INFORMATICS", name="Informatics")
    activate_site(site.pk)
    first = SiteDomain.objects.create(site=site, hostname="informatics.uog.edu.et")
    second = SiteDomain.objects.create(site=site, hostname="computing.uog.edu.et")
    barrier = Barrier(3)

    def attempt(domain_id):
        close_old_connections()
        try:
            with transaction.atomic():
                with connections["default"].cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '5s'")
                barrier.wait(timeout=10)
                domain = SiteDomain.objects.get(pk=domain_id)
                domain.is_primary = True
                domain.save(update_fields=["is_primary"])
            return "committed"
        except (ValidationError, IntegrityError):
            return "rejected"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt, domain.pk) for domain in (first, second)]
        barrier.wait(timeout=10)
        results = [future.result(timeout=20) for future in futures]
    assert sorted(results) == ["committed", "rejected"]
    assert SiteDomain.objects.filter(site=site, is_primary=True).count() == 1
