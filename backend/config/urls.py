"""
URL configuration for the UoG Digital Platform backend.
"""
from django.contrib import admin
from django.urls import include, path

from apps.core import views as core_views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    # Identity endpoints (Keycloak access tokens): /api/me/, /api/admin/*
    path("api/", include("apps.accounts.urls")),
    # Health endpoints (documented in docs/development/health.md)
    path("health/", include("apps.core.urls")),
    # Legacy liveness URL kept for backward compatibility
    path("health/", core_views.liveness),
]
