"""
URL configuration for the UoG Digital Platform backend.
"""
from django.contrib import admin
from django.urls import include, path

from apps.core import views as core_views
from apps.core.documentation import RedocView, SchemaView, SwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/schema/", SchemaView.as_view(), name="schema"),
    path("api/docs/", SwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", RedocView.as_view(url_name="schema"), name="redoc"),
    path("api/", include("apps.api.urls")),
    # Identity endpoints (Keycloak access tokens): /api/me/, /api/admin/*
    path("api/", include("apps.accounts.urls")),
    path("api/v1/organizations/", include("apps.organizations.api.urls")),
    path("api/v1/sites/", include("apps.sites.api.urls")),
    path("api/v1/cms/sites/", include("apps.cms.api.urls")),
    path("api/v1/site-context/", include("apps.sites.api.context_urls")),
    path("api/v1/site-templates/", include("apps.sites.api.template_urls")),
    path("api/v1/modules/", include("apps.sites.api.module_urls")),
    # Health endpoints (documented in docs/development/health.md)
    path("health/", include("apps.core.urls")),
    # Legacy liveness URL kept for backward compatibility
    path("health/", core_views.liveness),
]
