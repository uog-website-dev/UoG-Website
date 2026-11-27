"""Public site-resolution context. Not an administration collection."""
from django.urls import path

from apps.cms.api.menu_delivery import PublicMenusView
from apps.cms.api.public import (
    PublicHomepageView,
    PublicPageDetailView,
    PublicPageListView,
    PublicPostDetailView,
    PublicPostListView,
    PublicCategoryArchiveView,
    PublicDocumentCategoriesView,
    PublicDocumentListView,
    PublicDocumentFileView,
)

from apps.cms.api.public_search import PublicSearch
from apps.cms.api.events import PublicSiteEvents, PublicSiteEventDetail
from apps.cms.api.event_sessions import PublicSiteEventAgenda
from .context import SiteContextView
from apps.media.delivery import PublicMediaImage
from apps.cms.api.widget_runtime import PublicWidgetData, PublicSiteLogo, PublicContact

app_name = "site_context"
urlpatterns = [
    path("search/", PublicSearch.as_view(), name="public-search"),
    path("widgets/", PublicWidgetData.as_view(), name="public-widget-data"),
    path("identity/logo/", PublicSiteLogo.as_view(), name="public-site-logo"),
    path("contact/<uuid:page_id>/<str:form_code>/", PublicContact.as_view(), name="public-contact"),
    path("media/<uuid:asset_id>/", PublicMediaImage.as_view(), name="public-media-image"),
    path("", SiteContextView.as_view(), name="site-context"),
    path("menus/", PublicMenusView.as_view(), name="public-menus"),
    path("pages/", PublicPageListView.as_view(), name="public-page-list"),
    path("posts/categories/<slug:category_slug>/", PublicCategoryArchiveView.as_view(), name="public-category-archive"),
    path("posts/", PublicPostListView.as_view(), name="public-post-list"),
    path("documents/categories/", PublicDocumentCategoriesView.as_view(), name="public-document-categories"),
    path("documents/", PublicDocumentListView.as_view(), name="public-document-list"),
    path("documents/<uuid:document_id>/file/", PublicDocumentFileView.as_view(), name="public-document-file"),
    path("events/", PublicSiteEvents.as_view(), name="public-event-list"),
    path("events/<slug:slug>/agenda/", PublicSiteEventAgenda.as_view(), name="public-event-agenda"),
    path("events/<slug:slug>/", PublicSiteEventDetail.as_view(), name="public-event-detail"),
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
