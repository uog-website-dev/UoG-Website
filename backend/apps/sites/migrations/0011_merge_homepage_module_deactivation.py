"""Join independent homepage and module-trigger branches without data changes."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("sites", "0010_published_homepage"),
        ("sites", "0010_retained_module_deactivation"),
    ]
    operations = []
