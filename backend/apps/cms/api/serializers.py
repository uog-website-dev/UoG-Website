"""The shared content serialization contract.

Every future content endpoint (Pages, Posts, …) serializes the fields defined
here so the platform publishes one consistent content shape: identity and
scope are server-managed, `locale` and `metadata` are the caller's editables.

This story ships no content endpoints — shared primitives are deliberately
*not* a generic, unrestricted content API. The serializer exists so the
contract is reviewable, testable and reused instead of re-invented, and the
OpenAPI snapshot therefore stays unchanged.
"""
from rest_framework import serializers

from apps.sites.api.serializers import StrictFields

from ..models import Page, SiteContent


class SiteContentSerializer(StrictFields, serializers.ModelSerializer):
    """Read-only identity/scope fields; writable content editables."""

    immutable_on_update = ("id", "site", "created_by", "created_at")

    class Meta:
        model = SiteContent
        fields = (
            "id", "site", "status", "locale", "published_at",
            "created_by", "updated_by", "metadata", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "site", "status", "published_at",
            "created_by", "updated_by", "created_at", "updated_at",
        )


class PageSerializer(StrictFields, serializers.ModelSerializer):
    """The Page contract future content endpoints reuse.

    Identity, Site, computed route, homepage flag and lifecycle are
    server-managed; the caller may edit content, routing inputs and
    presentation hints. `parent` and `locale` are create-only: moving a
    subtree must go through the change_route service (which records URL
    history) and a page's language is fixed at creation.
    """

    immutable_on_update = ("id", "site", "parent", "locale", "created_by", "created_at")

    class Meta:
        model = Page
        fields = (
            "id", "site", "parent", "locale", "title", "slug", "path",
            "layout", "seo", "visibility", "position", "is_homepage",
            "status", "published_at", "created_by", "updated_by",
            "metadata", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "site", "path", "is_homepage", "status", "published_at",
            "created_by", "updated_by", "created_at", "updated_at",
        )
