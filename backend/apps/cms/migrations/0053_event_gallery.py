"""Event gallery associations to Site-owned Media images."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0052_event_resources"),
        ("media", "0015_document_revision_references"),
        ("sites", "0022_events_module"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EventGalleryImage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("caption", models.CharField(blank=True, default="", max_length=500)),
                ("alt_text", models.CharField(blank=True, default="", max_length=255)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("is_published", models.BooleanField(default=False)),
                ("usage_consent", models.BooleanField(default=False)),
                ("published_at", models.DateTimeField(blank=True, null=True)),
                ("removed_at", models.DateTimeField(blank=True, editable=False, null=True)),
                ("version", models.PositiveIntegerField(default=1, editable=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="gallery_images",
                        to="cms.event",
                    ),
                ),
                (
                    "media_asset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_gallery_images",
                        to="media.mediaasset",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="gallery_images",
                        to="cms.eventsession",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_gallery_images",
                        to="sites.site",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("sort_order", "created_at", "id"),
            },
        ),
        migrations.AddIndex(
            model_name="eventgalleryimage",
            index=models.Index(fields=["event", "is_published", "sort_order"], name="event_gal_pub_sort_idx"),
        ),
        migrations.AddIndex(
            model_name="eventgalleryimage",
            index=models.Index(fields=["site", "-created_at"], name="event_gal_site_created_idx"),
        ),
        migrations.AddIndex(
            model_name="eventgalleryimage",
            index=models.Index(fields=["event", "session", "sort_order"], name="event_gal_session_sort_idx"),
        ),
        migrations.AddConstraint(
            model_name="eventgalleryimage",
            constraint=models.UniqueConstraint(
                condition=models.Q(("removed_at__isnull", True)),
                fields=("event", "media_asset"),
                name="event_gal_active_asset_uniq",
            ),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_gallery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cms_event e WHERE e.id = NEW.event_id AND e.site_id = NEW.site_id) THEN
  RAISE EXCEPTION 'Gallery Event must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_gal_site_match';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM media_mediaasset a
  WHERE a.id = NEW.media_asset_id AND a.site_id = NEW.site_id AND a.deleted_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Gallery Media must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_gal_media_site';
 END IF;
 IF NEW.session_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cms_eventsession s WHERE s.id = NEW.session_id AND s.event_id = NEW.event_id AND s.removed_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Gallery Session must belong to the same Event.' USING ERRCODE='23514', CONSTRAINT='event_gal_session_match';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.media_asset_id IS DISTINCT FROM OLD.media_asset_id THEN
   RAISE EXCEPTION 'Gallery ownership is immutable.' USING ERRCODE='23514', CONSTRAINT='event_gal_identity_immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_gallery_guard BEFORE INSERT OR UPDATE ON cms_eventgalleryimage
 FOR EACH ROW EXECUTE FUNCTION cms_event_gallery_guard();
""",
            r"""
DROP TRIGGER IF EXISTS event_gallery_guard ON cms_eventgalleryimage;
DROP FUNCTION IF EXISTS cms_event_gallery_guard();
""",
        ),
    ]
