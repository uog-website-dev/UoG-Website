"""In-place saves of published Pages refresh the public snapshot."""
from apps.cms.tests.support import grant_cms_role
import pytest
from django.contrib.auth import get_user_model

from apps.cms.models import ContentRole, ContentStatus, PublishedContentSnapshot
from apps.cms.services.pages import create_page
from apps.cms.services.published_edits import published_content_write
from apps.cms.services.workflow import transition_content


pytestmark = pytest.mark.django_db


def _user(name):
    return get_user_model().objects.create_user(username=name)


def test_published_page_inplace_save_writes_snapshot(sites):
    site, _ = sites
    author, reviewer, publisher = (
        _user("inplace-author"),
        _user("inplace-reviewer"),
        _user("inplace-publisher"),
    )
    grant_cms_role(site=site, user=author, role=ContentRole.AUTHOR)
    grant_cms_role(site=site, user=reviewer, role=ContentRole.REVIEWER)
    grant_cms_role(site=site, user=publisher, role=ContentRole.PUBLISHER)
    page = create_page(
        site=site,
        title="Campus",
        slug="campus-inplace",
        blocks=[{"type": "paragraph", "html": "<p>Before</p>"}],
        actor=author,
    )
    transition_content(page.pk, action="submit", actor=author)
    transition_content(page.pk, action="approve", actor=reviewer)
    transition_content(page.pk, action="publish", actor=publisher)
    page.refresh_from_db()
    assert page.status == ContentStatus.PUBLISHED
    before = PublishedContentSnapshot.objects.filter(content_id=page.pk).count()

    page.blocks = [{
        "type": "image",
        "id": "img-1",
        "ref": f"sites/{site.pk}/placeholder",
        "alt": "Campus green",
    }]
    page.updated_by = author
    with published_content_write(page):
        page.save(update_fields=["blocks", "updated_by"])

    page.refresh_from_db()
    assert page.status == ContentStatus.PUBLISHED
    snaps = list(
        PublishedContentSnapshot.objects
        .filter(content_id=page.pk)
        .order_by("version")
    )
    assert len(snaps) == before + 1
    assert snaps[-1].payload["blocks"][0]["alt"] == "Campus green"
