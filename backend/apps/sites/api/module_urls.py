"""Module registry endpoints under /api/v1/modules/."""
from rest_framework.routers import SimpleRouter

from .views import ModuleViewSet

app_name = "platform_modules"

router = SimpleRouter()
router.register("", ModuleViewSet, basename="module")
urlpatterns = router.urls
