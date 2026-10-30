# Generated for P2-CMS-006.
import django.db.models.deletion
from django.db import migrations, models


FORWARD = """
INSERT INTO sites_module_implementation (code) VALUES ('PAGES')
ON CONFLICT (code) DO NOTHING;
UPDATE sites_module
   SET status = 'IMPLEMENTED',
       description = 'Site-scoped page authoring and published-only public delivery APIs.'
 WHERE code = 'PAGES';
"""

REVERSE = """
UPDATE sites_module
   SET status = 'PLANNED',
       is_enabled = FALSE,
       description = 'Registered pages capability. It is not implemented and cannot be enabled for a Site.'
 WHERE code = 'PAGES';
DELETE FROM sites_module_implementation WHERE code = 'PAGES';
"""


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0006_sitecontent_revision_number_contentrevision"),
        ("sites", "0007_sitedomain_audit"),
    ]

    operations = [
        migrations.CreateModel(
            name="SitePublicationVersion",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("locale", models.CharField(max_length=35)),
                ("version", models.PositiveBigIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cms_publication_versions",
                        to="sites.site",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("site", "locale"),
                        name="cms_site_locale_pub_version_uniq",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("locale__regex", r"\A[a-z]{2,3}(?:-[a-z0-9]{2,8})*\Z"),
                        ),
                        name="cms_pub_version_locale_format",
                    ),
                ],
            },
        ),
        migrations.RunSQL(FORWARD, reverse_sql=REVERSE),
    ]
