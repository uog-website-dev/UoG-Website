"""Site, domain and per-site module endpoints under /api/v1/sites/."""
from django.urls import path
from apps.cms.api.homepage_templates import HomepageTemplateCatalogue, HomepageTemplatePrepare, HomepageTemplateApply
from rest_framework.routers import SimpleRouter

from apps.cms.api.pages import SitePageViewSet
from apps.cms.api.documents import SiteDocuments, SiteDocumentCategories, SiteDocumentCategoryDetail, SiteDocumentDetail, SiteDocumentWorkflow, SiteDocumentFilePreview
from apps.cms.api.events import SiteEvents, SiteEventDetail, SiteEventAction, SiteEventPreview
from apps.cms.api.event_sessions import (
    SiteEventSessions,
    SiteEventSessionDetail,
    SiteEventSessionAction,
    SiteEventSessionsReorder,
)
from apps.cms.api.event_people import (
    SiteEventPeople,
    SiteEventPersonDetail,
    SiteEventSessionPeople,
    SiteEventSessionPersonDetail,
    SiteEventSessionPeopleReorder,
)
from apps.cms.api.event_registrations import (
    SiteEventRegistrationBadge,
    SiteEventRegistrationDetail,
    SiteEventRegistrations,
    SiteEventRegistrationsExport,
)
from apps.cms.api.event_resources import (
    SiteEventResourceDetail,
    SiteEventResourceFile,
    SiteEventResourceVisibility,
    SiteEventResources,
    SiteEventResourcesReorder,
)
from .event_categories import SiteEventCategories, SiteEventCategoryDetail
from apps.cms.api.sidebars import SidebarViewSet
from apps.cms.api.menus import MenuViewSet, MenuItemViewSet
from apps.cms.api.menu_delivery import MenuInheritanceDetailView, MenuInheritanceListView
from apps.cms.api.section_templates import SectionTemplateViewSet
from apps.api.posts_api import CategoryViewSet, PostViewSet, TagViewSet

from .views import SiteDomainViewSet, SiteModuleViewSet, SiteViewSet

app_name = "sites"

router = SimpleRouter()
router.register(r"(?P<site_pk>[0-9]+)/sidebars", SidebarViewSet, basename="sidebar")
router.register(r"(?P<site_pk>[0-9]+)/menus/(?P<menu_pk>[0-9a-f-]{36})/items", MenuItemViewSet, basename="menu-item")
router.register(r"(?P<site_pk>[0-9]+)/menus", MenuViewSet, basename="menu")
router.register(r"(?P<site_pk>[0-9]+)/section-templates", SectionTemplateViewSet, basename="section-template")
router.register(r"(?P<site_pk>[^/.]+)/pages", SitePageViewSet, basename="site-page")
router.register(r"(?P<site_pk>[^/.]+)/posts", PostViewSet, basename="site-post")
router.register(r"(?P<site_pk>[^/.]+)/categories", CategoryViewSet, basename="site-category")
router.register(r"(?P<site_pk>[^/.]+)/tags", TagViewSet, basename="site-tag")
router.register(r"(?P<site_pk>[^/.]+)/domains", SiteDomainViewSet, basename="sitedomain")
router.register(r"(?P<site_pk>[^/.]+)/modules", SiteModuleViewSet, basename="sitemodule")
router.register("", SiteViewSet, basename="site")
urlpatterns = [
    path("<int:site_pk>/event-categories/", SiteEventCategories.as_view(), name="site-event-categories"),
    path("<int:site_pk>/event-categories/<uuid:category_id>/", SiteEventCategoryDetail.as_view(), name="site-event-category-detail"),
    path("<int:site_pk>/events/", SiteEvents.as_view(), name="site-events"),
    path("<int:site_pk>/events/<uuid:event_id>/", SiteEventDetail.as_view(), name="site-event-detail"),
    path("<int:site_pk>/events/<uuid:event_id>/preview/", SiteEventPreview.as_view(), name="site-event-preview"),
    path("<int:site_pk>/events/<uuid:event_id>/registrations/", SiteEventRegistrations.as_view(), name="site-event-registrations"),
    path(
        "<int:site_pk>/events/<uuid:event_id>/registrations/export/",
        SiteEventRegistrationsExport.as_view(),
        name="site-event-registrations-export",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/registrations/<uuid:registration_id>/",
        SiteEventRegistrationDetail.as_view(),
        name="site-event-registration-detail",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/registrations/<uuid:registration_id>/badge/",
        SiteEventRegistrationBadge.as_view(),
        name="site-event-registration-badge",
    ),
    path("<int:site_pk>/events/<uuid:event_id>/resources/", SiteEventResources.as_view(), name="site-event-resources"),
    path(
        "<int:site_pk>/events/<uuid:event_id>/resources/reorder/",
        SiteEventResourcesReorder.as_view(),
        name="site-event-resources-reorder",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/resources/<uuid:resource_id>/",
        SiteEventResourceDetail.as_view(),
        name="site-event-resource-detail",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/resources/<uuid:resource_id>/visibility/",
        SiteEventResourceVisibility.as_view(),
        name="site-event-resource-visibility",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/resources/<uuid:resource_id>/file/",
        SiteEventResourceFile.as_view(),
        name="site-event-resource-file",
    ),
    path("<int:site_pk>/events/<uuid:event_id>/people/", SiteEventPeople.as_view(), name="site-event-people"),
    path(
        "<int:site_pk>/events/<uuid:event_id>/people/<uuid:person_id>/",
        SiteEventPersonDetail.as_view(),
        name="site-event-person-detail",
    ),
    path("<int:site_pk>/events/<uuid:event_id>/sessions/", SiteEventSessions.as_view(), name="site-event-sessions"),
    path(
        "<int:site_pk>/events/<uuid:event_id>/sessions/reorder/",
        SiteEventSessionsReorder.as_view(),
        name="site-event-sessions-reorder",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/sessions/<uuid:session_id>/",
        SiteEventSessionDetail.as_view(),
        name="site-event-session-detail",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/sessions/<uuid:session_id>/people/",
        SiteEventSessionPeople.as_view(),
        name="site-event-session-people",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/sessions/<uuid:session_id>/people/reorder/",
        SiteEventSessionPeopleReorder.as_view(),
        name="site-event-session-people-reorder",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/sessions/<uuid:session_id>/people/<uuid:assignment_id>/",
        SiteEventSessionPersonDetail.as_view(),
        name="site-event-session-person-detail",
    ),
    path(
        "<int:site_pk>/events/<uuid:event_id>/sessions/<uuid:session_id>/<str:action>/",
        SiteEventSessionAction.as_view(),
        name="site-event-session-action",
    ),
    path("<int:site_pk>/events/<uuid:event_id>/<str:action>/", SiteEventAction.as_view(), name="site-event-action"),
    path("<int:site_pk>/documents/categories/", SiteDocumentCategories.as_view(), name="site-document-categories"),
    path("<int:site_pk>/documents/categories/<uuid:category_id>/", SiteDocumentCategoryDetail.as_view(), name="site-document-category-detail"),
    path("<int:site_pk>/documents/", SiteDocuments.as_view(), name="site-documents"),
    path("<int:site_pk>/documents/<uuid:document_id>/", SiteDocumentDetail.as_view(), name="site-document-detail"),
    path("<int:site_pk>/documents/<uuid:document_id>/file/", SiteDocumentFilePreview.as_view(), name="site-document-file-preview"),
    path("<int:site_pk>/documents/<uuid:document_id>/<str:action>/", SiteDocumentWorkflow.as_view(), name="site-document-workflow"),
    path("<int:site_pk>/homepage-templates/", HomepageTemplateCatalogue.as_view(), name="homepage-template-catalogue"),
    path("<int:site_pk>/homepage-templates/prepare/", HomepageTemplatePrepare.as_view(), name="homepage-template-prepare"),
    path("<int:site_pk>/homepage-templates/apply/", HomepageTemplateApply.as_view(), name="homepage-template-apply"),
    path(
        "<int:site_pk>/menu-inheritance/",
        MenuInheritanceListView.as_view(),
        name="menu-inheritance-list",
    ),
    path(
        "<int:site_pk>/menu-inheritance/<str:location>/",
        MenuInheritanceDetailView.as_view(),
        name="menu-inheritance-detail",
    ),
    *router.urls,
]
