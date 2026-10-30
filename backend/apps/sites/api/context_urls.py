"""Public site-resolution context. Not an administration collection."""
from django.urls import path

from apps.cms.api.menu_delivery import PublicMenusView
from apps.cms.api.public import (
    PublicHomepageView,
    PublicPageDetailView,
    PublicPageListView,
)

from .context import SiteContextView

app_name = "site_context"
urlpatterns = [
    path("", SiteContextView.as_view(), name="site-context"),
    path("menus/", PublicMenusView.as_view(), name="public-menus"),
    path("pages/", PublicPageListView.as_view(), name="public-page-list"),
    path(
        "homepage/",
        PublicHomepageView.as_view(),
        name="public-homepage",
    ),
    path(
        "pages/<path:page_path>/",
        PublicPageDetailView.as_view(),
        name="public-page-detail",
    ),
]
