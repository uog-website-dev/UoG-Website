"""SiteContent enforces identity, ownership, status, locale and metadata rules."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from apps.cms.models import SiteContent
from apps.sites.models import Site

pytestmark = pytest.mark.django_db


def test_new_content_is_draft_in_the_sites_default_language(sites):
    site, _ = sites
    content = SiteContent(site=site)
    content.save()
    assert isinstance(content.pk, uuid.UUID)
    assert content.status == "DRAFT"
    assert content.locale == site.default_language
    assert content.published_at is None
    assert content.metadata == {}
    assert content.created_by_id is None


def test_content_identifiers_are_immutable(sites):
    site, _ = sites
    content = SiteContent(site=site)
    content.save()
    original = content.pk
    content.pk = uuid.uuid4()
    with pytest.raises(ValidationError) as error:
        content.save()
    assert "immutable" in str(error.value)
    assert SiteContent.objects.filter(pk=original).exists()
    assert not SiteContent.objects.filter(pk=content.pk).exists()


def test_content_cannot_move_between_sites(sites):
    first, second = sites
    content = SiteContent(site=first)
    content.save()
    content.site = second
    with pytest.raises(ValidationError) as error:
        content.save()
    assert "site" in error.value.error_dict
    content.refresh_from_db()
    assert content.site_id == first.pk


def test_status_transitions_follow_the_lifecycle(sites):
    site, _ = sites
    content = SiteContent(site=site)
    content.save()
    content.status = "PUBLISHED"
    content.save()
    assert content.published_at is not None
    first_publish = content.published_at
    content.save()  # same-state save is allowed
    content.status = "DRAFT"
    content.save()
    assert content.published_at == first_publish  # history is never erased
    content.status = "PUBLISHED"
    content.save()
    content.status = "ARCHIVED"
    content.save()
    content.status = "DRAFT"
    with pytest.raises(ValidationError) as error:
        content.save()
    assert "status" in error.value.error_dict
    content.refresh_from_db()
    assert content.status == "ARCHIVED"


def test_raw_updates_cannot_invent_a_status(sites):
    site, _ = sites
    content = SiteContent(site=site)
    content.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteContent.objects.filter(pk=content.pk).update(status="LIVE")


def test_locale_is_normalized_and_must_be_enabled_for_the_site(sites):
    first, _ = sites
    normalized = SiteContent(site=first, locale=f"  {first.default_language.upper()}  ")
    normalized.save()
    assert normalized.locale == first.default_language
    disabled = SiteContent(site=first, locale="de")
    with pytest.raises(ValidationError) as error:
        disabled.save()
    assert "locale" in error.value.error_dict
    malformed = SiteContent(site=first, locale="english!")
    with pytest.raises(ValidationError) as error:
        malformed.save()
    assert "locale" in error.value.error_dict


def test_locale_respects_the_owning_sites_enabled_languages(sites):
    first, _ = sites
    am_site = Site.objects.create(
        organization_unit=first.organization_unit,
        code="AMPORTAL", name="Am Portal", default_language="am",
    )
    am_content = SiteContent(site=am_site)
    am_content.save()
    assert am_content.locale == "am"
    # The other Site's default is not enabled here.
    foreign = SiteContent(site=am_site, locale=first.default_language)
    with pytest.raises(ValidationError) as error:
        foreign.save()
    assert "locale" in error.value.error_dict


def test_raw_locale_updates_hit_the_format_constraint(sites):
    site, _ = sites
    content = SiteContent(site=site)
    content.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteContent.objects.filter(pk=content.pk).update(locale="ENGLISH")


def test_metadata_must_be_a_json_object(sites):
    site, _ = sites
    content = SiteContent(site=site, metadata={"audience": "students"})
    content.save()
    content.metadata = ["not", "an", "object"]
    with pytest.raises(ValidationError) as error:
        content.save()
    assert "metadata" in error.value.error_dict
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteContent.objects.filter(pk=content.pk).update(metadata=["raw"])


def test_authorship_is_recorded_and_survives_account_removal(sites):
    site, _ = sites
    author = get_user_model().objects.create(username="content-author")
    content = SiteContent(site=site, created_by=author, updated_by=author)
    content.save()
    assert content.created_by_id == author.pk
    author.delete()
    content.refresh_from_db()
    assert content.created_by_id is None
    assert content.updated_by_id is None
    assert SiteContent.objects.filter(pk=content.pk).exists()


def test_a_site_that_owns_content_cannot_be_deleted(sites):
    site, _ = sites
    SiteContent(site=site).save()
    with pytest.raises(ProtectedError):
        Site.objects.filter(pk=site.pk).delete()
    assert SiteContent.objects.filter(site=site).exists()


def test_updated_at_moves_forward_on_every_save(sites):
    site, _ = sites
    content = SiteContent(site=site)
    content.save()
    stale = timezone.now() - timezone.timedelta(days=1)
    SiteContent.objects.filter(pk=content.pk).update(updated_at=stale)
    content.save()
    content.refresh_from_db()
    assert content.updated_at > stale
