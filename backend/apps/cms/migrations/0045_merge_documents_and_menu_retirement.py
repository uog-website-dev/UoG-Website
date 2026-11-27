"""Merge document feature migrations with menu primary-location retirement."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0042_retire_primary_menu_location"),
        ("cms", "0044_document_list_widget"),
    ]

    operations = []
