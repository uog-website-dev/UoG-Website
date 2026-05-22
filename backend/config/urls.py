"""
URL configuration for UoG Website Backend.
"""
from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
import api.views as api_views
from api.views import PageViewSet

router = DefaultRouter()
router.register(r'pages', PageViewSet)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include(router.urls)),
    path('health/', api_views.health),
]
