"""Join the optional Documents module and Site header migration branches."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("sites", "0011_documents_module"),
        ("sites", "0018_siteheader_brand_quote"),
    ]

    operations = []
