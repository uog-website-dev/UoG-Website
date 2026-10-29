import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.sites.models import Site
from apps.cms.models import Page

page = Page.objects.filter(slug="debug-xss").first()
if page is None:
    from apps.cms.services.pages import create_page
    site = Site.objects.first()
    page = create_page(
        site=site, title="D", slug="debug-xss",
        blocks=[{"type": "paragraph", "html": "<p onclick=alert(1)>w<script>alert(2)</script></p>"}],
    )
page.refresh_from_db()
print("STORED blocks:", page.blocks)
print("version:", page.blocks_version)
