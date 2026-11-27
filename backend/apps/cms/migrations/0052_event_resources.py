"""Event resource associations to Site-owned Documents."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0051_event_participants"),
        ("sites", "0022_events_module"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EventResource",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("BROCHURE", "Brochure"),
                            ("SLIDES", "Slides"),
                            ("AGENDA", "Agenda"),
                            ("HANDOUT", "Handout"),
                            ("OTHER", "Other"),
                        ],
                        default="OTHER",
                        max_length=16,
                    ),
                ),
                ("sort_order", models.PositiveIntegerField(default=0)),
                (
                    "visibility",
                    models.CharField(
                        choices=[
                            ("DRAFT", "Draft"),
                            ("PUBLIC", "Public"),
                            ("REGISTERED_ONLY", "Registered only"),
                        ],
                        default="DRAFT",
                        max_length=16,
                    ),
                ),
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
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_resources",
                        to="cms.document",
                    ),
                ),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="resources",
                        to="cms.event",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="resources",
                        to="cms.eventsession",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_resources",
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
            model_name="eventresource",
            index=models.Index(fields=["event", "visibility", "sort_order"], name="event_res_vis_sort_idx"),
        ),
        migrations.AddIndex(
            model_name="eventresource",
            index=models.Index(fields=["site", "-created_at"], name="event_res_site_created_idx"),
        ),
        migrations.AddIndex(
            model_name="eventresource",
            index=models.Index(fields=["event", "session", "sort_order"], name="event_res_session_sort_idx"),
        ),
        migrations.AddConstraint(
            model_name="eventresource",
            constraint=models.CheckConstraint(
                condition=models.Q(("visibility__in", ["DRAFT", "PUBLIC", "REGISTERED_ONLY"])),
                name="event_res_visibility_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventresource",
            constraint=models.CheckConstraint(
                condition=models.Q(("category__in", ["BROCHURE", "SLIDES", "AGENDA", "HANDOUT", "OTHER"])),
                name="event_res_category_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventresource",
            constraint=models.UniqueConstraint(
                condition=models.Q(("removed_at__isnull", True)),
                fields=("event", "document"),
                name="event_res_active_document_uniq",
            ),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_resource_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cms_event e WHERE e.id = NEW.event_id AND e.site_id = NEW.site_id) THEN
  RAISE EXCEPTION 'Resource Event must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_res_site_match';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM cms_document d
  JOIN cms_sitecontent sc ON sc.id = d.sitecontent_ptr_id
  WHERE d.sitecontent_ptr_id = NEW.document_id AND sc.site_id = NEW.site_id
 ) THEN
  RAISE EXCEPTION 'Resource Document must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_res_document_site';
 END IF;
 IF NEW.session_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cms_eventsession s WHERE s.id = NEW.session_id AND s.event_id = NEW.event_id AND s.removed_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Resource Session must belong to the same Event.' USING ERRCODE='23514', CONSTRAINT='event_res_session_match';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.document_id IS DISTINCT FROM OLD.document_id THEN
   RAISE EXCEPTION 'Resource ownership is immutable.' USING ERRCODE='23514', CONSTRAINT='event_res_identity_immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_resource_guard BEFORE INSERT OR UPDATE ON cms_eventresource
 FOR EACH ROW EXECUTE FUNCTION cms_event_resource_guard();
""",
            r"""
DROP TRIGGER IF EXISTS event_resource_guard ON cms_eventresource;
DROP FUNCTION IF EXISTS cms_event_resource_guard();
""",
        ),
    ]
