"""Site template endpoints under /api/v1/site-templates/."""
from rest_framework.routers import SimpleRouter

from .views import SiteTemplateViewSet

app_name = "site_templates"

router = SimpleRouter()
router.register("", SiteTemplateViewSet, basename="sitetemplate")
urlpatterns = router.urls
