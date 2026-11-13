"""Post placements share the Media Library's deletion serialization lock."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.core.exceptions import ValidationError
from django.db import close_old_connections

from apps.api.models import Post
from apps.media.models import MediaAsset, MediaAssetReference
from apps.media.removal import remove_asset
from apps.media.services import register_asset, update_asset
from apps.sites.api.access import Conflict
from .test_media_assets import media_world
from .test_media_uploads import png
from contextlib import contextmanager
import io

pytestmark = pytest.mark.django_db(transaction=True)


class ImageStorage:
    @contextmanager
    def open(self, bucket, key):
        yield io.BytesIO(png())


def test_article_link_and_asset_deletion_cannot_leave_a_dangling_reference(media_world, monkeypatch):
    world = media_world
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: None)
    asset = register_asset(
        world.actor, world.a.pk,
        storage_reference=f"platform-private:sites/{world.a.pk}/article-race.png",
        original_filename="article-race.png", storage=ImageStorage(),
    )
    update_asset(world.actor, world.a.pk, asset.pk, changes={"status":"READY"})
    barrier = Barrier(2)

    def link():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                Post.objects.create(
                    site=world.a, title="Concurrent article", slug="concurrent-article", content="News",
                    featured_media=f"sites/{world.a.pk}/assets/{asset.pk}",
                    metadata={"post_media":{"featured_alt":"Campus gardens"}},
                    created_by=world.actor, updated_by=world.actor,
                )
                return "linked"
            except ValidationError:
                return "link_rejected"
        finally:
            close_old_connections()

    def remove():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                remove_asset(world.actor, world.a.pk, asset.pk)
                return "deleted"
            except Conflict:
                return "deletion_rejected"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        linked = executor.submit(link)
        deleted = executor.submit(remove)
        outcomes = {linked.result(timeout=30), deleted.result(timeout=30)}
    asset = MediaAsset.objects.get(pk=asset.pk)
    if "linked" in outcomes:
        assert outcomes == {"linked","deletion_rejected"}
        assert asset.deleted_at is None
        assert MediaAssetReference.objects.filter(asset=asset).exists()
    else:
        assert outcomes == {"link_rejected","deleted"}
        assert asset.deleted_at is not None
        assert not MediaAssetReference.objects.filter(asset=asset).exists()
