"""Versioned organization administration endpoints."""
from rest_framework.routers import SimpleRouter

from .views import OrganizationViewSet

app_name = "organizations"

router = SimpleRouter()
router.register("", OrganizationViewSet, basename="organization")
urlpatterns = router.urls
