"""Public site-resolution context. Not an administration collection."""
from django.urls import path

from apps.cms.api.menu_delivery import PublicMenusView
from apps.cms.api.public import (
    PublicHomepageView,
    PublicPageDetailView,
    PublicPageListView,
    PublicPostDetailView,
    PublicPostListView,
)

from .context import SiteContextView
from apps.media.delivery import PublicMediaImage
from apps.cms.api.widget_runtime import PublicWidgetData, PublicSiteLogo, PublicContact

app_name = "site_context"
urlpatterns = [
    path("widgets/", PublicWidgetData.as_view(), name="public-widget-data"),
    path("identity/logo/", PublicSiteLogo.as_view(), name="public-site-logo"),
    path("contact/<uuid:page_id>/<str:form_code>/", PublicContact.as_view(), name="public-contact"),
    path("media/<uuid:asset_id>/", PublicMediaImage.as_view(), name="public-media-image"),
    path("", SiteContextView.as_view(), name="site-context"),
    path("menus/", PublicMenusView.as_view(), name="public-menus"),
    path("pages/", PublicPageListView.as_view(), name="public-page-list"),
    path("posts/", PublicPostListView.as_view(), name="public-post-list"),
    path("posts/<slug:post_slug>/", PublicPostDetailView.as_view(), name="public-post-detail"),
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
