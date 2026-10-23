"""One access policy for schema, Swagger and ReDoc."""
from drf_spectacular.views import (
    SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView,
)
from .permissions import DocumentationPermission


class PrivateDocumentationMixin:
    permission_classes = [DocumentationPermission]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response


class SchemaView(PrivateDocumentationMixin, SpectacularAPIView):
    pass


class SwaggerView(PrivateDocumentationMixin, SpectacularSwaggerView):
    pass


class RedocView(PrivateDocumentationMixin, SpectacularRedocView):
    pass
