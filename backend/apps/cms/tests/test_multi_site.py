"""Tenancy lives in the rows: one shared schema, Site-leading indexes, no cross-site keys."""
import pytest
from django.conf import settings
from django.db import connection, models

from apps.cms.models import SiteContent

pytestmark = pytest.mark.django_db


def test_content_is_scoped_to_its_own_site(sites):
    first, second = sites
    first_content = SiteContent(site=first)
    first_content.save()
    second_content = SiteContent(site=second)
    second_content.save()
    assert list(first.content.all().values_list("pk", flat=True)) == [first_content.pk]
    assert list(second.content.all().values_list("pk", flat=True)) == [second_content.pk]
    assert SiteContent.objects.filter(site=first).count() == 1
    assert SiteContent.objects.filter(site=second).count() == 1
    # Ids are per record: nothing is derived from the tenant, so they can
    # never collide across Sites or reveal how much content another owns.
    assert first_content.pk != second_content.pk


def test_cms_uses_the_shared_schema_only(sites):
    # No per-Site database or schema exists anywhere in the platform.
    assert set(settings.DATABASES) == {"default"}


def test_every_index_leads_with_site(sites):
    assert [index.fields[0] for index in SiteContent._meta.indexes] == ["site", "site"]
    names = {index.name for index in SiteContent._meta.indexes}
    assert names == {"cms_content_site_status_idx", "cms_content_site_recent_idx"}
    # Tenant separation is expressed by rows, not by a cross-Site unique key.
    assert not any(
        isinstance(constraint, models.UniqueConstraint)
        for constraint in SiteContent._meta.constraints
    )
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename = %s",
            ["cms_sitecontent"],
        )
        created = {row[0] for row in cursor.fetchall()}
    assert names <= created
    assert any("site_id" in name for name in created), "the FK itself must be indexed"


def test_one_sites_rows_never_appear_in_another_sites_query(sites):
    first, second = sites
    for _ in range(3):
        SiteContent(site=first, metadata={"n": _}).save()
    SiteContent(site=second).save()
    assert SiteContent.objects.filter(site=first).count() == 3
    assert SiteContent.objects.filter(site=second).count() == 1
    assert second.content.count() == 1
