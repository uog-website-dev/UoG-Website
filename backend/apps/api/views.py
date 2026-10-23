"""
Views for the API app.
"""
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from .models import Page
from .serializers import PageSerializer


class PageViewSet(viewsets.ModelViewSet):
    """ViewSet for Pages.

    Published pages are public (the public website reads them), writing
    requires a valid Keycloak access token.
    """

    queryset = Page.objects.filter(is_published=True)
    serializer_class = PageSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    @action(detail=False, methods=["get"])
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
