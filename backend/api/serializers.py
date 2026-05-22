"""
Serializers for the API app
"""
from rest_framework import serializers
from .models import Page


class PageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Page
        fields = ['id', 'title', 'slug', 'content', 'description', 'created_at', 'updated_at', 'is_published']
        read_only_fields = ['created_at', 'updated_at']
