import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0017_contact_submission"),
        ("sites", "0010_published_homepage"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SectionTemplate",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=120)),
                ("status", models.CharField(choices=[("ACTIVE", "Active"), ("RETIRED", "Retired")], default="ACTIVE", max_length=16)),
                ("schema_version", models.PositiveSmallIntegerField(default=1)),
                ("version", models.PositiveIntegerField(default=1)),
                ("section", models.JSONField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="created_section_templates", to=settings.AUTH_USER_MODEL)),
                ("site", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="section_templates", to="sites.site")),
                ("updated_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="updated_section_templates", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "indexes": [
                    models.Index(fields=["site", "status", "-updated_at"], name="cms_sectmpl_site_status_idx"),
                    models.Index(fields=["site", "name"], name="cms_sectmpl_site_name_idx"),
                ],
                "constraints": [
                    models.CheckConstraint(condition=models.Q(("status__in", ["ACTIVE", "RETIRED"])), name="cms_sectmpl_status_valid"),
                    models.CheckConstraint(condition=models.Q(("schema_version__gte", 1)), name="cms_sectmpl_schema_version_positive"),
                    models.CheckConstraint(condition=models.Q(("version__gte", 1)), name="cms_sectmpl_version_positive"),
                ],
            },
        ),
    ]
