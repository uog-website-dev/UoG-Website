from django.db import migrations

from apps.sites.domain_audit_sql import FORWARD, REVERSE


class Migration(migrations.Migration):

    dependencies = [
        ("sites", "0006_sitemodule_settings"),
        ("audit", "0002_common_writer"),
    ]

    operations = [
        migrations.RunSQL(FORWARD, reverse_sql=REVERSE),
    ]
