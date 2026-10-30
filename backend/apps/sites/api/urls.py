"""Site, domain and per-site module endpoints under /api/v1/sites/."""
from rest_framework.routers import SimpleRouter

from apps.cms.api.pages import SitePageViewSet

from .views import SiteDomainViewSet, SiteModuleViewSet, SiteViewSet

app_name = "sites"

router = SimpleRouter()
router.register(r"(?P<site_pk>[^/.]+)/pages", SitePageViewSet, basename="site-page")
router.register(r"(?P<site_pk>[^/.]+)/domains", SiteDomainViewSet, basename="sitedomain")
router.register(r"(?P<site_pk>[^/.]+)/modules", SiteModuleViewSet, basename="sitemodule")
router.register("", SiteViewSet, basename="site")
urlpatterns = router.urls
