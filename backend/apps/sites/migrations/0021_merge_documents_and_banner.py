"""Merge documents/header merge with title-banner configuration branch."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("sites", "0019_merge_documents_and_header"),
        ("sites", "0020_banner_hero_patterns"),
    ]

    operations = []
