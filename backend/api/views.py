"""
Views for the API app
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Page
from .serializers import PageSerializer
from django.http import HttpResponse


class PageViewSet(viewsets.ModelViewSet):
    """ViewSet for Pages"""
    queryset = Page.objects.filter(is_published=True)
    serializer_class = PageSerializer

    @action(detail=False, methods=['get'])
    def home(self, request):
        """Get the home page"""
        page, created = Page.objects.get_or_create(
            slug='home',
            defaults={
                'title': 'Home',
                'content': '<h1>Welcome to UoG Website</h1><p>This is a placeholder for the home page.</p>',
                'description': 'Home page',
            }
        )
        serializer = self.get_serializer(page)
        return Response(serializer.data)


def health(request):
    """Simple health endpoint that does not touch the database."""
    return HttpResponse('OK', status=200)
