"""
Views for the API app.
"""
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiExample, extend_schema, extend_schema_view
from rest_framework import status, viewsets
from rest_framework.decorators import action
from apps.authorization.permissions import PageAccessPermission
from apps.authorization.services import record_decision
from rest_framework.response import Response

from .models import Page
from .serializers import PageSerializer


@extend_schema(tags=["CMS"])
@extend_schema_view(
    list=extend_schema(auth=[], description=(
        "Published platform-wide pages. Page-number pagination uses page (20 items per page). "
        "Default order is newest created_at first. Filtering, search, client-selected sorting "
        "and Organization/Site scoping are not implemented; unknown query parameters do not scope access."
    )),
    retrieve=extend_schema(auth=[]),
    create=extend_schema(examples=[OpenApiExample("Create a page", request_only=True, value={
        "title": "About UoG", "slug": "about-uog", "content": "<p>About the university</p>",
        "description": "University overview", "is_published": True,
    })]),
)
class PageViewSet(viewsets.ModelViewSet):
    """ViewSet for Pages.

    Published reads remain public; every write requires the matching
    database-backed application permission.
    """

    queryset = Page.objects.select_related("site", "site__organization_unit").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in {"list", "retrieve"}:
            return queryset.filter(is_published=True)
        return queryset

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if request.method in {"GET", "HEAD"}:
            response["Cache-Control"] = "public, max-age=60"
        else:
            response["Cache-Control"] = "private, no-store"
        return response

    def perform_create(self, serializer):
        page = serializer.save()
        record_decision(user=self.request.user, action="PAGE_CREATED", outcome="CHANGE",
                        permission_code="content.pages.create", resource_type="page",
                        resource_id=page.pk, organization_id=page.site.organization_unit_id if page.site_id else None,
                        site_id=page.site_id, request=self.request)

    def perform_update(self, serializer):
        page = serializer.save()
        record_decision(user=self.request.user, action="PAGE_UPDATED", outcome="CHANGE",
                        permission_code="content.pages.update", resource_type="page",
                        resource_id=page.pk, organization_id=page.site.organization_unit_id if page.site_id else None,
                        site_id=page.site_id, request=self.request)

    def perform_destroy(self, instance):
        record_decision(user=self.request.user, action="PAGE_DELETED", outcome="CHANGE",
                        permission_code="content.pages.delete", resource_type="page",
                        resource_id=instance.pk, organization_id=instance.site.organization_unit_id if instance.site_id else None,
                        site_id=instance.site_id, request=self.request)
        instance.delete()

    serializer_class = PageSerializer
    permission_classes = [PageAccessPermission]

    @extend_schema(
        responses=PageSerializer, filters=False,
        auth=[], description="Return the published home page as a single object; 404 when none exists. This read does not mutate storage.",
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def home(self, request):
        """Return the published home page; never mutate storage on an anonymous GET."""
        page = Page.objects.filter(slug="home", is_published=True).first()
        if page is None:
            return Response({"detail": "Not found."}, status=404)
        serializer = self.get_serializer(page)
        return Response(serializer.data, status=status.HTTP_200_OK)



def health(request):
    """Legacy simple health endpoint that does not touch dependencies."""
    return HttpResponse("OK", status=200)
