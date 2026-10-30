"""Site, domain and per-site module endpoints under /api/v1/sites/."""
from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.cms.api.pages import SitePageViewSet
from apps.cms.api.menus import MenuViewSet, MenuItemViewSet
from apps.cms.api.menu_delivery import MenuInheritanceDetailView, MenuInheritanceListView

from .views import SiteDomainViewSet, SiteModuleViewSet, SiteViewSet

app_name = "sites"

router = SimpleRouter()
router.register(r"(?P<site_pk>[0-9]+)/menus/(?P<menu_pk>[0-9a-f-]{36})/items", MenuItemViewSet, basename="menu-item")
router.register(r"(?P<site_pk>[0-9]+)/menus", MenuViewSet, basename="menu")
router.register(r"(?P<site_pk>[^/.]+)/pages", SitePageViewSet, basename="site-page")
router.register(r"(?P<site_pk>[^/.]+)/domains", SiteDomainViewSet, basename="sitedomain")
router.register(r"(?P<site_pk>[^/.]+)/modules", SiteModuleViewSet, basename="sitemodule")
router.register("", SiteViewSet, basename="site")
urlpatterns = [
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
