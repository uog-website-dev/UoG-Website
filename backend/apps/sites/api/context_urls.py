"""Public site-resolution context. Not an administration collection."""
from django.urls import path

from .context import SiteContextView

app_name = "site_context"
urlpatterns = [path("", SiteContextView.as_view(), name="site-context")]
