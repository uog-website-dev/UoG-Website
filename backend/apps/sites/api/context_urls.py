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
from apps.cms.api.events import (
    PublicSiteEvents,
    PublicSiteEventDetail,
    PublicSiteEventsCalendar,
    PublicSiteEventCategories,
)
from apps.cms.api.event_sessions import PublicSiteEventAgenda
from apps.cms.api.event_people import PublicSiteEventSpeakers
from apps.cms.api.event_registrations import (
    PublicSiteEventRegistrations,
    PublicSiteEventRegistrationCancel,
)
from apps.cms.api.event_resources import (
    PublicSiteEventResourceEntitlement,
    PublicSiteEventResourceFile,
    PublicSiteEventResources,
)
from apps.cms.api.event_gallery import PublicSiteEventGallery
from apps.cms.api.event_updates import PublicSiteEventNotices, PublicSiteEventUpdates
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
    path("events/calendar/", PublicSiteEventsCalendar.as_view(), name="public-event-calendar"),
    path("events/categories/", PublicSiteEventCategories.as_view(), name="public-event-categories"),
    path("events/<slug:slug>/agenda/", PublicSiteEventAgenda.as_view(), name="public-event-agenda"),
    path("events/<slug:slug>/speakers/", PublicSiteEventSpeakers.as_view(), name="public-event-speakers"),
    path("events/<slug:slug>/registrations/", PublicSiteEventRegistrations.as_view(), name="public-event-registrations"),
    path("events/<slug:slug>/registrations/cancel/", PublicSiteEventRegistrationCancel.as_view(), name="public-event-registration-cancel"),
    path("events/<slug:slug>/updates/", PublicSiteEventUpdates.as_view(), name="public-event-updates"),
    path("events/<slug:slug>/notices/", PublicSiteEventNotices.as_view(), name="public-event-notices"),
    path("events/<slug:slug>/gallery/", PublicSiteEventGallery.as_view(), name="public-event-gallery"),
    path("events/<slug:slug>/resources/", PublicSiteEventResources.as_view(), name="public-event-resources"),
    path(
        "events/<slug:slug>/resources/<uuid:resource_id>/entitlement/",
        PublicSiteEventResourceEntitlement.as_view(),
        name="public-event-resource-entitlement",
    ),
    path(
        "events/<slug:slug>/resources/<uuid:resource_id>/file/",
        PublicSiteEventResourceFile.as_view(),
        name="public-event-resource-file",
    ),
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
