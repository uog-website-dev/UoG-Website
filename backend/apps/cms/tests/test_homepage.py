"""Exactly one homepage per Site: domain check, database race, atomic swap."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connections, transaction

from apps.cms.models import ContentEditConflict, Page
from apps.cms.selectors.pages import homepage_of
from apps.cms.services.pages import create_page, set_as_homepage

pytestmark = pytest.mark.django_db


def test_zero_homepages_is_valid_and_replacement_stays_single(sites):
    site, other = sites
    first = create_page(site=site, title="Home", slug="home")
    second = create_page(site=site, title="Alternate", slug="alt")
    # "Where configured": no homepage yet is a valid state.
    assert homepage_of(site.pk) is None
    set_as_homepage(first)
    assert homepage_of(site.pk).pk == first.pk
    set_as_homepage(second)
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.is_homepage is False
    assert second.is_homepage is True
    assert Page.objects.filter(site_id=site.pk, is_homepage=True).count() == 1
    # The other Site's state is untouched.
    assert homepage_of(other.pk) is None


def test_the_domain_rejects_a_second_homepage(sites):
    site, _ = sites
    first = create_page(site=site, title="One", slug="one")
    second = create_page(site=site, title="Two", slug="two")
    set_as_homepage(first)
    second.is_homepage = True
    with pytest.raises(ValidationError):
        second.save()
    second.refresh_from_db()
    assert second.is_homepage is False
    assert Page.objects.filter(site_id=site.pk, is_homepage=True).count() == 1


def test_the_database_rejects_concurrent_homepage_flags(sites):
    # The race: both writers passed the domain check; only the trigger stands
    # between the Site and two homepages.
    site, _ = sites
    first = create_page(site=site, title="One", slug="one")
    second = create_page(site=site, title="Two", slug="two")
    set_as_homepage(first)
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=second.pk).update(is_homepage=True)
    second.refresh_from_db()
    assert second.is_homepage is False
    assert Page.objects.filter(site_id=site.pk, is_homepage=True).count() == 1


def test_a_failed_swap_leaves_the_previous_homepage_in_place(sites):
    site, _ = sites
    first = create_page(site=site, title="One", slug="one")
    second = create_page(site=site, title="Two", slug="two")
    set_as_homepage(first)
    # The save inside the service fails after the previous flag was cleared:
    # the transaction must roll the clear back.
    second.seo = ["broken"]
    with pytest.raises(ValidationError):
        set_as_homepage(second)
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.is_homepage is True
    assert second.is_homepage is False


@pytest.mark.django_db(transaction=True)
def test_racing_homepage_saves_leave_exactly_one(sites):
    site, _ = sites
    first = create_page(site=site, title="One", slug="one")
    second = create_page(site=site, title="Two", slug="two")
    barrier = Barrier(3)

    def attempt(page_id):
        close_old_connections()
        try:
            with transaction.atomic():
                with connections["default"].cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '5s'")
                barrier.wait(timeout=10)
                page = Page.objects.get(pk=page_id)
                page.is_homepage = True
                page.save(update_fields=["is_homepage"])
            return "committed"
        except (ContentEditConflict, ValidationError, IntegrityError):
            return "rejected"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt, item.pk) for item in (first, second)]
        barrier.wait(timeout=10)
        results = [future.result(timeout=20) for future in futures]
    assert sorted(results) == ["committed", "rejected"]
    assert Page.objects.filter(site_id=site.pk, is_homepage=True).count() == 1
