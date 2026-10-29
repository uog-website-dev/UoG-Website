"""The shared content serialization contract.

Every future content endpoint (Pages, Posts, …) serializes the fields defined
here so the platform publishes one consistent content shape: identity and
scope are server-managed, `locale` and `metadata` are the caller's editables.

This story ships no content endpoints — shared primitives are deliberately
*not* a generic, unrestricted content API. The serializer exists so the
contract is reviewable, testable and reused instead of re-invented, and the
OpenAPI snapshot therefore stays unchanged.
"""
from django.core.exceptions import ValidationError as DjangoValidationError

from rest_framework import serializers

from apps.sites.api.serializers import StrictFields

from ..blocks import validate_blocks
from ..models import Page, SiteContent


class BlocksValidationMixin:
    """Validate blocks before serializer.save(), using the owning Site scope."""

    def validate_blocks(self, value):
        site_id = getattr(self.instance, "site_id", None)
        if site_id is None:
            site = self.context.get("site")
            site_id = getattr(site, "pk", None)
            if site_id is None:
                site_id = self.context.get("site_id")
        try:
            return validate_blocks(value, site_id=site_id)
        except DjangoValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else error.messages
            )
            raise serializers.ValidationError(detail) from error


class SiteContentSerializer(
    BlocksValidationMixin, StrictFields, serializers.ModelSerializer,
):
    """Read-only identity/scope fields; writable content editables."""

    immutable_on_update = ("id", "site", "created_by", "created_at")

    class Meta:
        model = SiteContent
        fields = (
            "id", "site", "status", "locale", "published_at", "blocks",
            "blocks_version", "created_by", "updated_by", "metadata",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "site", "status", "published_at",
            "blocks_version", "created_by", "updated_by", "created_at",
            "updated_at",
        )


class PageSerializer(
    BlocksValidationMixin, StrictFields, serializers.ModelSerializer,
):
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
            "status", "published_at", "blocks", "blocks_version",
            "created_by", "updated_by", "metadata", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "site", "path", "is_homepage", "status", "published_at",
            "blocks_version", "created_by", "updated_by",
            "created_at", "updated_at",
        )
