"""The shared content serializer pins the API contract future endpoints reuse."""
import pytest

from apps.cms.api.serializers import SiteContentSerializer
from apps.cms.models import SiteContent

pytestmark = pytest.mark.django_db

FIELDS = {
    "id", "site", "status", "locale", "published_at",
    "created_by", "updated_by", "metadata", "created_at", "updated_at",
}
EDITABLES = {"locale", "metadata"}


def test_contract_exposes_only_approved_fields():
    serializer = SiteContentSerializer()
    assert set(serializer.fields) == FIELDS
    writable = {
        name for name, field in serializer.fields.items() if not field.read_only
    }
    assert writable == EDITABLES
    # Identity, scope, lifecycle and authorship are server-managed.
    read_only = {
        name for name, field in serializer.fields.items() if field.read_only
    }
    assert read_only == FIELDS - EDITABLES


def test_identity_scope_and_unknown_fields_are_rejected_from_input():
    conflict = SiteContentSerializer(data={"site": 1, "status": "PUBLISHED", "locale": "en"})
    assert not conflict.is_valid()
    assert set(conflict.errors) == {"site", "status"}
    unknown = SiteContentSerializer(data={"slug": "welcome"})
    assert not unknown.is_valid()
    assert set(unknown.errors) == {"slug"}


def test_update_rejects_immutable_identity_fields(sites):
    first, second = sites
    content = SiteContent(site=first)
    content.save()
    serializer = SiteContentSerializer(
        content, data={"site": second.pk, "locale": "en"}, partial=True,
    )
    assert not serializer.is_valid()
    assert set(serializer.errors) == {"site"}


def test_valid_editables_validate_and_malformed_locale_does_not(sites):
    site, _ = sites
    valid = SiteContentSerializer(
        data={"locale": site.default_language, "metadata": {"tags": ["news"]}},
    )
    assert valid.is_valid(), valid.errors
    assert valid.validated_data["metadata"] == {"tags": ["news"]}
    malformed = SiteContentSerializer(data={"locale": "english!"})
    assert not malformed.is_valid()
    assert "locale" in malformed.errors


def test_serialized_shape_matches_the_documented_contract(sites):
    site, other = sites
    content = SiteContent(site=site, metadata={"audience": "students"})
    content.save()
    data = SiteContentSerializer(content).data
    assert set(data) == FIELDS
    assert data["id"] == str(content.pk)
    assert data["site"] == site.pk
    assert data["status"] == "DRAFT"
    assert data["locale"] == site.default_language
    assert data["published_at"] is None
    assert data["metadata"] == {"audience": "students"}
    assert data["created_at"] and data["updated_at"]
