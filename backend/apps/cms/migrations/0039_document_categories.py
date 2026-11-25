"""Keep the established CMS migration name for document category setup.

The document tables and category relation are created together by
0038_site_document in this source tree. Older environments recorded this
follow-up migration name separately; keeping the node preserves their
migration history without recreating those tables.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('cms', '0038_site_document')]
    operations = []
