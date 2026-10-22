"""URL configuration for the API app."""
from rest_framework.routers import DefaultRouter

from .views import PageViewSet

router = DefaultRouter()
router.register(r"pages", PageViewSet)

urlpatterns = router.urls
