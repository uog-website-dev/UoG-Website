"""
Serializers for the API app
"""
import re

from rest_framework import serializers
from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from apps.sites.models import Site
from .models import Category, Page, Post, Tag


CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_-]{0,63}$")


@extend_schema_serializer(examples=[OpenApiExample(
    "Published page", response_only=True, value={
        "id": 1, "title": "About UoG", "slug": "about-uog",
        "content": "<p>About the university</p>", "description": "University overview",
        "is_published": True, "created_at": "2026-10-23T08:00:00Z",
        "updated_at": "2026-10-23T08:00:00Z",
    },
)])
class PageSerializer(serializers.ModelSerializer):
    site = serializers.PrimaryKeyRelatedField(queryset=Site.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Page
        fields = ['id', 'title', 'slug', 'content', 'description', 'site', 'created_at', 'updated_at', 'is_published']
        read_only_fields = ['created_at', 'updated_at']


class StrictContentFields:
    """Reject unknown, read-only and immutable fields instead of ignoring them."""

    immutable_on_update = ()

    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {
                name for name, field in self.fields.items()
                if not field.read_only
            }
            if self.instance is not None:
                writable -= set(self.immutable_on_update)
            forbidden = set(data) - writable
            if forbidden:
                raise serializers.ValidationError({
                    key: ["Unknown, read-only, or immutable field."]
                    for key in sorted(forbidden)
                })
        return super().to_internal_value(data)


class TaxonomySerializer(StrictContentFields, serializers.ModelSerializer):
    """Shared Category/Tag contract: stable code, name-derived slug, active flag."""

    slug = serializers.SlugField(required=False, allow_blank=True, max_length=128)
    code = serializers.CharField(max_length=64)
    immutable_on_update = ("id", "site", "created_at")

    class Meta:
        model = Category
        fields = (
            "id", "site", "code", "name", "slug", "is_active", "locale",
            "status", "published_at", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "site", "status", "published_at", "created_at", "updated_at",
        )

    def validate_code(self, value):
        if not CODE_PATTERN.match(value or ""):
            raise serializers.ValidationError(
                "Use an uppercase letter followed by uppercase letters, digits, "
                "underscores or hyphens, such as CAMPUS_NEWS."
            )
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Provide a non-blank name.")
        return value

    def validate_is_active(self, value):
        if value is None:
            raise serializers.ValidationError("Provide true or false.")
        return value


@extend_schema_serializer(component_name="PostCategory")
class CategorySerializer(TaxonomySerializer):
    class Meta(TaxonomySerializer.Meta):
        model = Category


@extend_schema_serializer(component_name="PostTag")
class TagSerializer(TaxonomySerializer):
    class Meta(TaxonomySerializer.Meta):
        model = Tag


class PostSerializer(StrictContentFields, serializers.ModelSerializer):
    """Site-scoped post authoring contract.

    Site, status, publication timestamp, revision and workflow attribution are
    server-managed; the caller edits content, routing slug, taxonomy and the
    allowlisted SEO object.
    """

    slug = serializers.SlugField(required=False, allow_blank=True, max_length=128)
    categories = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), many=True, required=False,
    )
    tags = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), many=True, required=False,
    )
    immutable_on_update = ("id", "site", "created_at")

    class Meta:
        model = Post
        fields = (
            "id", "site", "title", "slug", "excerpt", "content", "excerpt_html",
            "author", "featured_media", "seo", "categories", "tags", "locale",
            "status", "published_at", "blocks", "blocks_version",
            "revision_number", "created_by", "updated_by", "submitted_by",
            "reviewed_by", "review_comment", "metadata", "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id", "site", "status", "published_at", "blocks_version",
            "revision_number", "created_by", "updated_by", "submitted_by",
            "reviewed_by", "review_comment", "created_at", "updated_at",
        )

    def _site_id(self):
        if self.instance is not None:
            return self.instance.site_id
        site = self.context.get("site")
        return getattr(site, "pk", None) or self.context.get("site_id")

    def validate_title(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Provide a non-blank title.")
        return value

    def validate_categories(self, value):
        site_id = self._site_id()
        foreign = [
            str(category.pk) for category in value
            if site_id is not None and category.site_id != site_id
        ]
        if foreign:
            raise serializers.ValidationError(
                "These categories belong to another Site: "
                + ", ".join(sorted(foreign)) + "."
            )
        return value

    def validate_tags(self, value):
        site_id = self._site_id()
        foreign = [
            str(tag.pk) for tag in value
            if site_id is not None and tag.site_id != site_id
        ]
        if foreign:
            raise serializers.ValidationError(
                "These tags belong to another Site: "
                + ", ".join(sorted(foreign)) + "."
            )
        return value

    def validate_seo(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("SEO metadata must be a JSON object.")
        return value
