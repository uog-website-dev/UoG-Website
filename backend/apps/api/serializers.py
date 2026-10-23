"""
Serializers for the API app
"""
from rest_framework import serializers
from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from .models import Page


@extend_schema_serializer(examples=[OpenApiExample(
    "Published page", response_only=True, value={
        "id": 1, "title": "About UoG", "slug": "about-uog",
        "content": "<p>About the university</p>", "description": "University overview",
        "is_published": True, "created_at": "2026-10-23T08:00:00Z",
        "updated_at": "2026-10-23T08:00:00Z",
    },
)])
class PageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Page
        fields = ['id', 'title', 'slug', 'content', 'description', 'created_at', 'updated_at', 'is_published']
        read_only_fields = ['created_at', 'updated_at']
