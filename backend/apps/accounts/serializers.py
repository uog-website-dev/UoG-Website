"""Response contracts for the identity API."""
from rest_framework import serializers


class IdentitySerializer(serializers.Serializer):
    username = serializers.CharField()
    email = serializers.EmailField(allow_blank=True)
    name = serializers.CharField(allow_blank=True)
    roles = serializers.ListField(child=serializers.CharField())
    is_staff = serializers.BooleanField()
    client_id = serializers.CharField()
    scopes = serializers.ListField(child=serializers.CharField())
    expires_at = serializers.IntegerField(help_text="Access-token expiry as Unix seconds.")


class AdminOverviewSerializer(serializers.Serializer):
    pages = serializers.IntegerField(min_value=0)
    published_pages = serializers.IntegerField(min_value=0)
    users = serializers.IntegerField(min_value=0)
    requested_by = serializers.CharField()
