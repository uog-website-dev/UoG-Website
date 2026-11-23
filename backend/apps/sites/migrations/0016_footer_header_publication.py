"""Draft/publication split for Site chrome and explicit footer column copy.

Existing footer and header settings become both the draft and the initial
published snapshot, so no visitor-facing value changes on deploy. Footer
columns are seeded from the currently published footer menus, using the internal
menu name only where no explicit public heading exists yet.

Reverse removes the new publication/column fields. Export the published
snapshots before downgrading; draft values remain in their original columns.
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

FOOTER_FIELDS = (
    "newsletter_label", "newsletter_url", "support_label", "support_url",
    "description", "address", "email", "phone", "links_heading",
    "highlight_label", "highlight_url", "copyright_text", "social_links",
)
HEADER_FIELDS = (
    "brand_href", "search_enabled", "sticky", "cta_label", "cta_url",
    "language_switcher",
)


def seed_publications(apps, schema_editor):
    SiteFooter = apps.get_model("sites", "SiteFooter")
    SiteHeader = apps.get_model("sites", "SiteHeader")
    Assignment = apps.get_model("cms", "MenuLocationAssignment")
    Menu = apps.get_model("cms", "Menu")
    for footer in SiteFooter.objects.all().iterator():
        assignment = Assignment.objects.filter(
            site_id=footer.site_id, location="footer", is_published=True,
        ).first()
        identifiers = list(assignment.published_menus or []) if assignment else []
        menus = {str(menu.pk): menu for menu in Menu.objects.filter(pk__in=identifiers)}
        columns = [
            {"menu": identifier, "heading": menus[identifier].name, "description": ""}
            for identifier in identifiers if identifier in menus
        ]
        footer.columns = columns
        footer.published_settings = {
            **{field: getattr(footer, field) for field in FOOTER_FIELDS},
            "columns": columns,
        }
        footer.save(update_fields=["columns", "published_settings"])
    for header in SiteHeader.objects.all().iterator():
        header.published_settings = {field: getattr(header, field) for field in HEADER_FIELDS}
        header.save(update_fields=["published_settings"])


class Migration(migrations.Migration):
    dependencies = [
        ("sites", "0015_site_header_settings"),
        ("cms", "0029_footer_menu_columns"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.AddField(
            model_name="sitefooter",
            name="columns",
            field=models.JSONField(default=list, blank=True),
        ),
        migrations.AddField(
            model_name="sitefooter",
            name="published_settings",
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="sitefooter",
            name="previous_published_settings",
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="sitefooter",
            name="published_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="sitefooter",
            name="published_by",
            field=models.ForeignKey(blank=True, editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="siteheader",
            name="published_settings",
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="siteheader",
            name="previous_published_settings",
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="siteheader",
            name="published_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="siteheader",
            name="published_by",
            field=models.ForeignKey(blank=True, editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(seed_publications, migrations.RunPython.noop),
    ]
