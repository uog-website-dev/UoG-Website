"""Central module management endpoints under /api/v1/site-modules/."""
from rest_framework.routers import SimpleRouter

from .module_management import ModuleOperationViewSet, SiteModuleManagementViewSet

app_name = "site_module_management"

router = SimpleRouter()
router.register("operations", ModuleOperationViewSet, basename="operation")
router.register("", SiteModuleManagementViewSet, basename="site-module")
urlpatterns = router.urls
