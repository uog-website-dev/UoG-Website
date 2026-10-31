"""The shared content serialization contract.

Every future content endpoint (Pages, Posts, …) serializes the fields defined
here so the platform publishes one consistent content shape: identity and
scope are server-managed, `locale` and `metadata` are the caller's editables.

These serializers are reused by the workflow API and history responses. CMS
does not expose unrestricted content CRUD or public serving.
"""
from django.core.exceptions import ValidationError as DjangoValidationError

from drf_spectacular.utils import extend_schema_field, extend_schema_serializer
from rest_framework import serializers

from apps.sites.api.serializers import StrictFields

from ..blocks import validate_blocks
from ..models import (
    ContentRole, ContentStatus, Page, SiteContent,
    SiteContentRoleAssignment,
)


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
            "blocks_version", "revision_number", "created_by", "updated_by", "submitted_by",
            "reviewed_by", "review_comment", "metadata",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "site", "status", "published_at",
            "blocks_version", "created_by", "updated_by", "created_at",
            "revision_number", "submitted_by", "reviewed_by", "review_comment", "updated_at",
        )


@extend_schema_serializer(component_name="SitePage")
class PageSerializer(
    BlocksValidationMixin, StrictFields, serializers.ModelSerializer,
):
    """The Page contract future content endpoints reuse.

    Identity, Site, computed route, homepage flag and lifecycle are
    server-managed; the caller may edit content, routing inputs and
    presentation hints. Moving a subtree goes through the change_route
    service (which records URL history); a page's language is fixed at creation.
    """

    parent = serializers.PrimaryKeyRelatedField(
        queryset=Page.objects.all(), required=False, allow_null=True,
        help_text=(
            "Parent Page on the same Site and locale. Reparenting preserves "
            "route history and cannot create a cycle."
        ),
    )
    available_actions = serializers.SerializerMethodField()

    immutable_on_update = ("id", "site", "locale", "created_by", "created_at")

    class Meta:
        model = Page
        fields = (
            "id", "site", "parent", "locale", "title", "slug", "path",
            "layout", "seo", "visibility", "position", "is_homepage",
            "status", "published_at", "blocks", "blocks_version",
            "revision_number",
            "created_by", "updated_by", "submitted_by", "reviewed_by",
            "review_comment", "metadata", "created_at", "updated_at",
            "available_actions",
        )
        read_only_fields = (
            "id", "site", "path", "is_homepage", "status", "published_at",
            "blocks_version", "created_by", "updated_by", "submitted_by",
            "revision_number", "reviewed_by", "review_comment",
            "created_at", "updated_at",
        )

    def validate_parent(self, value):
        site_id = getattr(self.instance, "site_id", None)
        if site_id is None:
            site_id = getattr(self.context.get("site"), "pk", None)
        if value is not None and value.site_id != site_id:
            raise serializers.ValidationError("Parent Page must belong to this Site.")
        if self.instance is not None and value is not None and value.pk == self.instance.pk:
            raise serializers.ValidationError("A Page cannot be its own parent.")
        return value

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_available_actions(self, page):
        """Return workflow actions the current authenticated user may attempt.

        The workflow service remains authoritative; this list only drives
        controls and is derived from the same Site role assignments.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            return []
        claims = getattr(request, "auth", None)
        roles = getattr(claims, "roles", ())
        roles = set(roles) if isinstance(roles, (tuple, list, set, frozenset)) else set()
        is_admin = getattr(request, "_cms_is_platform_admin", None)
        if is_admin is None:
            try:
                from apps.authorization.access import is_platform_administrator
                is_admin = is_platform_administrator(user)
            except (ImportError, AttributeError):
                is_admin = False
            request._cms_is_platform_admin = is_admin
        if is_admin or "platform-admin" in roles:
            content_roles = set(ContentRole.values)
        else:
            roles_by_site = getattr(request, "_cms_content_roles_by_site", {})
            if page.site_id not in roles_by_site:
                roles_by_site[page.site_id] = set(SiteContentRoleAssignment.objects.filter(
                    site_id=page.site_id, user_id=user.pk, user__is_active=True,
                ).values_list("role", flat=True))
                request._cms_content_roles_by_site = roles_by_site
            content_roles = roles_by_site[page.site_id]

        actions = []
        if page.status == ContentStatus.DRAFT and ContentRole.AUTHOR in content_roles:
            actions.append("submit")
        if (
            page.status == ContentStatus.IN_REVIEW
            and ContentRole.REVIEWER in content_roles
            and user.pk not in {page.created_by_id, page.submitted_by_id}
        ):
            actions.extend(("approve", "reject"))
        if page.status == ContentStatus.APPROVED and ContentRole.PUBLISHER in content_roles:
            actions.append("publish")
        if page.status == ContentStatus.PUBLISHED and ContentRole.PUBLISHER in content_roles:
            actions.append("unpublish")
        if page.status in {ContentStatus.APPROVED, ContentStatus.PUBLISHED, ContentStatus.UNPUBLISHED} and ContentRole.PUBLISHER in content_roles:
            actions.append("archive")
        if page.status == ContentStatus.UNPUBLISHED and ContentRole.AUTHOR in content_roles:
            actions.append("restore")
        return actions
