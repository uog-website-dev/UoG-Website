"""
Serializers for the API app
"""
import re

from rest_framework import serializers
from drf_spectacular.extensions import OpenApiSerializerFieldExtension
from drf_spectacular.utils import OpenApiExample, extend_schema_field, extend_schema_serializer
from apps.cms.models import ContentStatus
from apps.cms.workflow_actions import available_workflow_actions
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


class ArticleDocumentField(serializers.JSONField):
    """Virtual input/output field; legacy read responses contain null."""


class ArticleDocumentFieldSchema(OpenApiSerializerFieldExtension):
    target_class = ArticleDocumentField

    def map_serializer_field(self, auto_schema, direction):
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["schema_version", "html"],
            "properties": {
                "schema_version": {"type": "integer", "enum": [1]},
                "html": {
                    "type": "string", "maxLength": 200000,
                    "description": "Sanitized article HTML; maximum 200000 UTF-8 bytes, 2000 elements and depth 16.",
                },
            },
        }
        if direction == "response":
            schema["nullable"] = True
        return schema


@extend_schema_serializer(examples=[OpenApiExample(
    "Formatted article draft", request_only=True, value={
        "title": "Campus research update", "slug": "campus-research-update",
        "excerpt": "A short university news summary", "categories": [], "tags": [],
        "editor_document": {"schema_version": 1, "html": "<h2>Research news</h2><p>A <strong>university</strong> report.</p>"},
    },
)])
class PostSerializer(StrictContentFields, serializers.ModelSerializer):
    """Site-scoped post authoring contract.

    Site, status, publication timestamp, revision and workflow attribution are
    server-managed; the caller edits content, routing slug, taxonomy and the
    allowlisted SEO object.
    """

    slug = serializers.SlugField(
        required=False, allow_blank=True, max_length=128,
        help_text="Unique within the Site and language. Reserved route names are rejected. Reviewed and published permalinks use the CMS workflow lock.",
    )
    content = serializers.CharField(required=False)
    editor_document = ArticleDocumentField(required=False, help_text='Version 1 article document with schema_version=1 and bounded HTML. Supported tags are p, h2-h4, strong, em, ul, ol, li, blockquote, a and br. Inline images use img with data-asset-id, unique UUID data-node-id and required alt, with no stored src. Server sanitization is authoritative.')
    draft_of = serializers.UUIDField(source="draft_of_id", read_only=True, allow_null=True)
    publication_slug = serializers.SerializerMethodField()
    publication_status = serializers.SerializerMethodField()
    last_publication_at = serializers.SerializerMethodField()
    featured_alt = serializers.CharField(required=False, allow_blank=True, max_length=1000, help_text="Alternative text for the selected featured asset.")
    available_actions = serializers.SerializerMethodField()
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
            "id", "site", "title", "slug", "excerpt", "content", "editor_document", "excerpt_html",
            "author", "featured_media", "featured_alt", "draft_of", "publication_slug", "publication_status", "last_publication_at", "seo", "categories", "tags", "locale",
            "status", "published_at", "blocks", "blocks_version",
            "revision_number", "created_by", "updated_by", "submitted_by",
            "reviewed_by", "review_comment", "metadata", "created_at",
            "updated_at", "available_actions",
        )
        read_only_fields = (
            "id", "site", "status", "published_at", "blocks_version",
            "revision_number", "created_by", "updated_by", "submitted_by",
            "reviewed_by", "review_comment", "draft_of", "publication_slug", "created_at", "updated_at",
        )

    @extend_schema_field(serializers.CharField())
    def get_publication_status(self, post):
        return post.draft_of.status if post.draft_of_id else post.status

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_last_publication_at(self, post):
        from apps.cms.models import PublishedContentSnapshot
        date = PublishedContentSnapshot.objects.filter(content_id=post.draft_of_id or post.pk).order_by("-version").values_list("published_at",flat=True).first()
        return date.isoformat() if date else None

    @extend_schema_field(serializers.CharField())
    def get_publication_slug(self, post):
        return post.draft_of.slug if post.draft_of_id else post.slug

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_available_actions(self, post):
        """Return workflow actions the current caller may attempt for this Post."""
        return available_workflow_actions(post, self.context.get("request"))

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

    def validate_editor_document(self, value):
        from django.core.exceptions import ValidationError as DomainError
        from .post_editor import normalize_document

        try:
            return normalize_document(value)
        except DomainError as error:
            details = error.message_dict if hasattr(error, "message_dict") else error.messages
            raise serializers.ValidationError(details) from error

    def validate(self, attrs):
        existing_metadata = getattr(self.instance, "metadata", {})
        source = attrs.get("metadata", existing_metadata)
        if not isinstance(source, dict):
            raise serializers.ValidationError({"metadata": "Use a JSON object."})
        metadata = dict(source)
        if "metadata" in attrs and "post_editor" in attrs["metadata"]:
            raise serializers.ValidationError({"metadata": "Use editor_document to edit the article body."})
        if "metadata" in attrs and "post_media" in attrs["metadata"]:
            raise serializers.ValidationError({"metadata": "Use featured_alt to edit image text."})
        if "post_media" in existing_metadata:
            metadata["post_media"] = existing_metadata["post_media"]
        if "featured_alt" in attrs:
            metadata["post_media"] = {"featured_alt": attrs.pop("featured_alt").strip()}
            attrs["metadata"] = metadata
        # Ordinary metadata edits must not discard the authoritative editor body.
        if "metadata" in attrs and "post_editor" in existing_metadata:
            metadata["post_editor"] = existing_metadata["post_editor"]
            attrs["metadata"] = metadata
        if "editor_document" in attrs:
            if "content" in attrs or "blocks" in attrs:
                raise serializers.ValidationError({
                    "editor_document": "Send editor_document as the article body without content or blocks.",
                })
            document = attrs.pop("editor_document")
            metadata["post_editor"] = document
            attrs.update(metadata=metadata, content=document["html"], blocks=[])
        elif "content" in attrs or "blocks" in attrs:
            # A legacy client owns its complete body representation on that save.
            metadata.pop("post_editor", None)
            attrs["metadata"] = metadata
        if self.instance is None and not attrs.get("content"):
            raise serializers.ValidationError({"content": "Provide content or a versioned editor_document."})
        if self.instance is not None and self.instance.status in {
            ContentStatus.IN_REVIEW, ContentStatus.APPROVED,
            ContentStatus.PUBLISHED, ContentStatus.ARCHIVED,
        }:
            if "categories" in attrs:
                current = set(self.instance.categories.values_list("pk", flat=True))
                incoming = {category.pk for category in attrs["categories"]}
                if current != incoming:
                    raise serializers.ValidationError({
                        "categories": [
                            "Categories are locked while this Post is in review, "
                            "approved, published or archived.",
                        ],
                    })
            if "tags" in attrs:
                current = set(self.instance.tags.values_list("pk", flat=True))
                incoming = {tag.pk for tag in attrs["tags"]}
                if current != incoming:
                    raise serializers.ValidationError({
                        "tags": [
                            "Tags are locked while this Post is in review, "
                            "approved, published or archived.",
                        ],
                    })
        from .post_media import validate_post_images, featured_asset_id
        from django.core.exceptions import ValidationError as DomainError
        candidate = Post(
            site_id=self._site_id(),
            featured_media=attrs.get("featured_media", getattr(self.instance, "featured_media", "")),
            metadata=attrs.get("metadata", metadata),
        )
        changed = self.instance is None or candidate.featured_media != self.instance.featured_media or candidate.metadata.get("post_editor") != existing_metadata.get("post_editor") or candidate.metadata.get("post_media") != existing_metadata.get("post_media")
        try:
            if "featured_media" in attrs and attrs["featured_media"] and (self.instance is None or attrs["featured_media"] != self.instance.featured_media):
                featured_asset_id(attrs["featured_media"], self._site_id())
            validate_post_images(candidate, actor=self.context["request"].user if changed else None)
        except DomainError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["editor_document"] = instance.metadata.get("post_editor")
        data["featured_alt"] = instance.metadata.get("post_media", {}).get("featured_alt", "")
        return data

    def create(self, validated_data):
        taxonomy = {
            field: validated_data.pop(field)
            for field in ("categories", "tags") if field in validated_data
        }
        instance = Post(**validated_data)
        instance.save(force_insert=True, taxonomy=taxonomy)
        return instance

    def update(self, instance, validated_data):
        taxonomy = {
            field: validated_data.pop(field)
            for field in ("categories", "tags") if field in validated_data
        }
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save(taxonomy=taxonomy)
        return instance

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
        inactive = [str(category.pk) for category in value if not category.is_active]
        if inactive:
            raise serializers.ValidationError(
                "These categories are inactive and cannot be assigned: "
                + ", ".join(sorted(inactive)) + "."
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
        inactive = [str(tag.pk) for tag in value if not tag.is_active]
        if inactive:
            raise serializers.ValidationError(
                "These tags are inactive and cannot be assigned: "
                + ", ".join(sorted(inactive)) + "."
            )
        return value

    def validate_seo(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("SEO metadata must be a JSON object.")
        image_ref = value.get("og_image_ref")
        if image_ref:
            from apps.cms.blocks import Rejection, check_image_ref

            try:
                value = {**value, "og_image_ref": check_image_ref(image_ref, site_id=self._site_id())}
            except Rejection as error:
                raise serializers.ValidationError({
                    "og_image_ref": str(error),
                }) from error
        return value
