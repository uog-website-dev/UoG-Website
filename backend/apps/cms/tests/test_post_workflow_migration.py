"""Rehearse the additive article link against an existing published Post."""
import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from apps.api.models import Post
from apps.cms.models import PublishedContentSnapshot
from .test_public_posts import _publish


@pytest.mark.django_db(transaction=True)
def test_post_working_draft_migration_reverse_and_upgrade_preserve_legacy_publication(sites,posts_module):
    article = Post.objects.create(site=sites[0],title="Legacy approved article",slug="legacy-approved-article",content="Legacy body")
    _publish(article)
    publication = PublishedContentSnapshot.objects.get(content=article).payload
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [("api","0006_enable_shipped_content_modules")]
    try:
        executor.migrate(previous)
        old = executor.loader.project_state(previous).apps.get_model("api","Post")
        assert old.objects.get(pk=article.pk).content == "Legacy body"
        assert "draft_of" not in {field.name for field in old._meta.fields}
    finally:
        MigrationExecutor(connection).migrate(latest)
    current = Post.objects.get(pk=article.pk)
    assert current.draft_of_id is None and current.status == "PUBLISHED"
    assert current.content == "Legacy body"
    assert PublishedContentSnapshot.objects.get(content=article).payload == publication
