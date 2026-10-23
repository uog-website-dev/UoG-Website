"""
Views for the API app.
"""
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiExample, extend_schema, extend_schema_view
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from .models import Page
from .serializers import PageSerializer


@extend_schema(tags=["CMS"])
@extend_schema_view(
    list=extend_schema(description=(
        "Published platform-wide pages. Page-number pagination uses page (20 items per page). "
        "Default order is newest created_at first. Filtering, search, client-selected sorting "
        "and Organization/Site scoping are not implemented; unknown query parameters do not scope access."
    )),
    create=extend_schema(examples=[OpenApiExample("Create a page", request_only=True, value={
        "title": "About UoG", "slug": "about-uog", "content": "<p>About the university</p>",
        "description": "University overview", "is_published": True,
    })]),
)
class PageViewSet(viewsets.ModelViewSet):
    """ViewSet for Pages.

    Published pages are public (the public website reads them), writing
    requires a valid Keycloak access token.
    """

    queryset = Page.objects.filter(is_published=True)
    serializer_class = PageSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    @extend_schema(
        responses=PageSerializer, filters=False,
        description="Return the home page as a single object. The existing implementation seeds the page if absent; this GET therefore has a database side effect.",
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def home(self, request):
        """Get (or seed) the home page."""
        page, _created = Page.objects.get_or_create(
            slug="home",
            defaults={
                "title": "Home",
                "content": "<h1>Welcome to the University of Gondar Digital Platform</h1>"
                "<p>This is a placeholder for the home page.</p>",
                "description": "Home page",
            },
        )
        serializer = self.get_serializer(page)
        return Response(serializer.data, status=status.HTTP_200_OK)


def health(request):
    """Legacy simple health endpoint that does not touch dependencies."""
    return HttpResponse("OK", status=200)
