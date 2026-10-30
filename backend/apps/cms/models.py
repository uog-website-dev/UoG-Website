"""Site-scoped content primitives shared by every content type.

Pages, Posts and future content records all own exactly one Site and share
one publishing contract, so publishing logic is never duplicated per type.
This module is a *primitive*: it defines the shared domain and its rules,
not a generic content API. See docs/architecture/cms-content-data-model.md
for the site-scoped uniqueness and index strategy.
"""
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, router, transaction
from django.db.models import Q, Value
from django.db.models.lookups import Exact
from django.utils import timezone

from . import blocks as blocks_schema


class ContentStatus(models.TextChoices):
    """Lifecycle shared by every content record."""

    DRAFT = "DRAFT", "Draft"
    IN_REVIEW = "IN_REVIEW", "In review"
    APPROVED = "APPROVED", "Approved"
    PUBLISHED = "PUBLISHED", "Published"
    UNPUBLISHED = "UNPUBLISHED", "Unpublished"
    ARCHIVED = "ARCHIVED", "Archived"


_workflow_write = ContextVar("cms_workflow_write", default=False)
_revision_origin = ContextVar("cms_revision_origin", default=None)


class ContentEditConflict(Exception):
    """Raised when a stale content instance attempts to overwrite newer data."""


@contextmanager
def workflow_write():
    """Allow the workflow service to persist a validated status transition."""
    token = _workflow_write.set(True)
    try:
        yield
    finally:
        _workflow_write.reset(token)


@contextmanager
def revision_origin(revision):
    token = _revision_origin.set(revision)
    try:
        yield
    finally:
        _revision_origin.reset(token)


LANGUAGE_FORMAT = r"\A[a-z]{2,3}(?:-[a-z0-9]{2,8})*\Z"


class SiteContent(models.Model):
    """One record of site-owned content.

    Concrete so that migration, constraint and multi-site behaviour are real
    and testable today; later content types (Page, Post, …) subclass it via
    multi-table inheritance and inherit the columns, indexes and publishing
    rules instead of re-declaring them.
    """

    id = models.UUIDField(
        primary_key=True, default=uuid.uuid4, editable=False,
        help_text="Immutable identifier. UUIDs are assigned once and can never "
                  "be changed or re-sequenced, so ids are not enumerable across Sites.",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="content",
        help_text="Owning Site. Content cannot be moved between Sites.",
    )
    status = models.CharField(
        max_length=11, choices=ContentStatus.choices, default=ContentStatus.DRAFT,
        help_text="Shared draft, review, approval, publication, unpublication and archive workflow.",
    )
    locale = models.CharField(
        max_length=35, blank=True, default="",
        validators=[RegexValidator(
            LANGUAGE_FORMAT,
            "Use a normalized language code such as en, am or en-us.",
        )],
        help_text="BCP-47-style language tag in the same format as the Site's "
                  "language codes. Empty means the Site's default language; an "
                  "explicit value must be enabled for the Site. Storage format "
                  "only — this does not claim a translation workflow.",
    )
    published_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When the record was first published. Set on the first "
                  "publish and kept as history if the record is unpublished.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
        help_text="Authoring platform user, cleared if the account is removed.",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
        help_text="Last editing platform user, cleared if the account is removed.",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
        help_text="User who most recently submitted this content for review.",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
        help_text="User who most recently approved or rejected this content.",
    )
    review_comment = models.TextField(
        blank=True, default="",
        help_text="Most recent reviewer comment, retained when content is rejected.",
    )
    metadata = models.JSONField(
        default=dict, blank=True,
        help_text="Free-form JSON object for approved content metadata. Not a "
                  "settings document and never a place for secrets.",
    )
    blocks = models.JSONField(
        blank=True, default=list,
        help_text="Ordered structured content: a JSON array of typed block "
                  "objects (heading, paragraph, image, button, list, "
                  "section) validated against the documented, versioned "
                  "block schema. Paragraph rich text is sanitized on write. "
                  "An empty list is valid and every content type — this one "
                  "and future Post records — shares the same blocks.",
    )
    blocks_version = models.CharField(
        max_length=8, default=blocks_schema.SCHEMA_VERSION,
        help_text="Schema version the blocks were written with, stored so "
                  "future block-schema migrations can interpret and "
                  "migrate stored payloads. Server-managed.",
    )
    revision_number = models.PositiveIntegerField(
        default=0,
        editable=False,
        help_text="Monotonically increasing content revision used for optimistic concurrency.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=ContentStatus.values),
                name="content_status",
            ),
            models.CheckConstraint(
                condition=Q(locale__regex=LANGUAGE_FORMAT),
                name="content_locale_format",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("metadata", function="jsonb_typeof", output_field=models.CharField()),
                    Value("object"),
                ),
                name="content_metadata_object",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("blocks", function="jsonb_typeof", output_field=models.CharField()),
                    Value("array"),
                ),
                name="content_blocks_array",
            ),
            models.CheckConstraint(
                condition=Q(blocks_version__in=sorted(blocks_schema.SUPPORTED_SCHEMA_VERSIONS)),
                name="content_blocks_version",
            ),
        ]
        indexes = [
            # Ownership-leading indexes: every content query is scoped by the
            # owning Site first (docs/architecture/cms-content-data-model.md).
            models.Index(fields=["site", "status"], name="cms_content_site_status_idx"),
            models.Index(fields=["site", "-updated_at"], name="cms_content_site_recent_idx"),
        ]

    def __str__(self):
        return f"{self.site_id}:{self.pk}"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        if "revision_number" in field_names:
            instance._loaded_revision_number = instance.revision_number
        else:
            instance._loaded_revision_number = (
                cls._base_manager.using(db)
                .filter(pk=instance.pk)
                .values_list("revision_number", flat=True)
                .first()
            )
        return instance

    def refresh_from_db(self, using=None, fields=None, from_queryset=None):
        super().refresh_from_db(
            using=using, fields=fields, from_queryset=from_queryset,
        )
        self._loaded_revision_number = self.revision_number

    def _validate_content(self):
        previous = None
        if not self._state.adding:
            using = self._state.db or router.db_for_write(type(self), instance=self)
            previous = (
                type(self).objects.using(using)
                .filter(pk=self.pk)
                .values(
                    "site_id", "status", "locale", "metadata", "blocks",
                    "blocks_version", "submitted_by_id", "reviewed_by_id",
                    "review_comment",
                )
                .first()
            )
            if previous is None:
                raise ValidationError({"id": "Content identifiers are immutable."})
            if previous["site_id"] != self.site_id:
                raise ValidationError({"site": "Content cannot be moved between Sites."})
            if previous["status"] != self.status and not _workflow_write.get():
                raise ValidationError({
                    "status": "Use the content workflow service to change status.",
                })
            if not _workflow_write.get() and any(
                previous[name] != getattr(self, name)
                for name in (
                    "submitted_by_id", "reviewed_by_id", "review_comment",
                )
            ):
                raise ValidationError({
                    "review_comment": "Workflow attribution and comments are "
                                      "managed by the workflow service.",
                })
            if previous["status"] in {
                ContentStatus.IN_REVIEW, ContentStatus.APPROVED,
                ContentStatus.PUBLISHED, ContentStatus.ARCHIVED,
            } and any(
                previous[name] != getattr(self, name)
                for name in ("locale", "metadata", "blocks", "blocks_version")
            ):
                raise ValidationError({
                    "status": "Content is locked while in review, approved, "
                              "published or archived. Return it to an editable "
                              "state through the workflow first.",
                })
        elif self.status != ContentStatus.DRAFT:
            raise ValidationError({"status": "New content must start as a draft."})

        if not isinstance(self.metadata, dict):
            raise ValidationError({"metadata": "Metadata must be a JSON object."})

        if self.site_id:
            enabled = self._enabled_languages()
            if not self.locale:
                # Absent locale inherits the Site's default language, which the
                # Site's own constraints guarantee to be enabled.
                self.locale = self.site.default_language
            elif enabled and self.locale not in enabled:
                raise ValidationError({
                    "locale": "This language is not enabled for the Site. "
                              "Enable it in the Site configuration first.",
                })

        if self.status == ContentStatus.PUBLISHED and self.published_at is None:
            self.published_at = timezone.now()

    def _validate_blocks(self):
        """Validate the block payload; the subclass calls this last so its
        own field normalization (locale, path, …) has settled before a
        rejection — the model's constraint checks run against this
        instance after clean, and an unset field from an earlier raise
        would otherwise shadow the real error with format-constraint
        noise.
        """
        if self.blocks_version not in blocks_schema.SUPPORTED_SCHEMA_VERSIONS:
            raise ValidationError({
                "blocks_version": (
                    "This block schema version is not supported here. "
                    "Supported: " + ", ".join(sorted(blocks_schema.SUPPORTED_SCHEMA_VERSIONS)) + "."
                ),
            })
        if not isinstance(self.blocks, list):
            raise ValidationError({"blocks": "blocks must be a JSON array of block objects."})
        try:
            self.blocks = blocks_schema.validate_blocks(self.blocks, site_id=self.site_id)
        except ValidationError as error:
            if hasattr(error, "error_dict"):
                raise ValidationError(dict(error.error_dict)) from error
            raise

    def clean(self):
        self._validate_content()
        self._validate_blocks()

    def _enabled_languages(self):
        configuration = (self.site.configuration or {}) if self.site_id else {}
        enabled = configuration.get("language", {}).get("enabled")
        if isinstance(enabled, list) and enabled:
            return [str(value) for value in enabled]
        return [self.site.default_language] if self.site_id else []

    def full_clean(self, *args, **kwargs):
        if isinstance(self.locale, str):
            self.locale = self.locale.strip().lower()
        return super().full_clean(*args, **kwargs)

    def save(self, *args, **kwargs):
        from .services.revisions import (
            MAX_REVISION_SNAPSHOT_BYTES,
            content_revision_write,
            create_content_revision,
            revision_snapshot,
            snapshot_size,
        )

        using = kwargs.get("using") or router.db_for_write(
            type(self), instance=self,
        )
        supplied_locale = self.locale
        supplied_published_at = self.published_at
        supplied_blocks = self.blocks
        with transaction.atomic(using=using):
            previous = None
            before = None
            if not self._state.adding:
                previous = (
                    type(self).objects.using(using)
                    .select_for_update()
                    .filter(pk=self.pk)
                    .first()
                )
                if previous is None:
                    raise ValidationError({"id": "Content identifiers are immutable."})
                loaded_revision = getattr(self, "_loaded_revision_number", None)
                if (
                    loaded_revision is not None
                    and loaded_revision != previous.revision_number
                ):
                    raise ContentEditConflict(
                        "Content changed after this instance was loaded."
                    )
                before = revision_snapshot(previous)
                self.revision_number = previous.revision_number

            self.full_clean()
            update_fields = kwargs.get("update_fields")
            if update_fields is not None:
                fields = set(update_fields) | {"updated_at"}
                if self.locale != supplied_locale:
                    fields.add("locale")
                if self.published_at != supplied_published_at:
                    fields.add("published_at")
                if self.blocks != supplied_blocks:
                    fields.add("blocks")
                if previous is not None and getattr(self, "path", None) != getattr(previous, "path", None):
                    fields.add("path")
                kwargs["update_fields"] = fields

            candidate = revision_snapshot(self)
            if previous is not None and kwargs.get("update_fields") is not None:
                candidate = _merge_revision_snapshot(
                    before, candidate, kwargs["update_fields"],
                )
            changed_fields = (
                _revision_changed_fields(before, candidate)
                if before is not None
                else sorted(
                    key for key in candidate
                    if key not in {"content_id", "content_type", "site_id"}
                )
            )
            if snapshot_size(candidate) > MAX_REVISION_SNAPSHOT_BYTES:
                raise ValidationError({
                    "revision": (
                        "Content snapshots must not exceed "
                        f"{MAX_REVISION_SNAPSHOT_BYTES} bytes."
                    ),
                })

            if previous is None:
                self.revision_number = 1
            elif changed_fields:
                self.revision_number = previous.revision_number + 1
            if kwargs.get("update_fields") is not None and changed_fields:
                kwargs["update_fields"].add("revision_number")

            with content_revision_write(using=using):
                result = super().save(*args, **kwargs)
                if changed_fields:
                    saved = (
                        type(self).objects.using(using)
                        .select_for_update()
                        .get(pk=self.pk)
                    )
                    saved_snapshot = revision_snapshot(saved)
                    actual_changes = (
                        _revision_changed_fields(before, saved_snapshot)
                        if before is not None
                        else changed_fields
                    )
                    if actual_changes:
                        create_content_revision(
                            saved,
                            snapshot=saved_snapshot,
                            changed_fields=actual_changes,
                            using=using,
                            restored_from=_revision_origin.get(),
                        )
                    self.revision_number = saved.revision_number
            self._loaded_revision_number = self.revision_number
            return result

    def delete(self, *args, **kwargs):
        from .services.revisions import content_revision_delete

        using = kwargs.get("using") or self._state.db or router.db_for_write(
            type(self), instance=self,
        )
        with transaction.atomic(using=using):
            with content_revision_delete(using=using):
                return super().delete(*args, **kwargs)


def _merge_revision_snapshot(before, candidate, update_fields):
    """Reflect only fields a partial model save will persist."""
    aliases = {
        "parent_id": "parent",
        "created_by_id": "created_by",
        "updated_by_id": "updated_by",
        "submitted_by_id": "submitted_by",
        "reviewed_by_id": "reviewed_by",
    }
    merged = dict(before)
    for key, value in candidate.items():
        field_name = aliases.get(key, key)
        if field_name in update_fields:
            merged[key] = value
    return merged


def _revision_changed_fields(before, after):
    if before is None:
        return []
    return sorted(
        key for key in before
        if key not in {"content_id", "content_type", "site_id"}
        and before[key] != after[key]
    )


class Visibility(models.TextChoices):
    """How a published page participates in public serving and listings."""

    PUBLIC = "PUBLIC", "Public"
    UNLISTED = "UNLISTED", "Unlisted"
    HIDDEN = "HIDDEN", "Hidden"


SLUG_FORMAT = r"\A[a-z0-9]+(?:-[a-z0-9]+)*\Z"
PATH_FORMAT = r"\A/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*\Z"
LAYOUT_FORMAT = r"\A[A-Z][A-Z0-9_-]{0,63}\Z"

# Hard cap on hierarchy depth. It bounds path length (15 * 129 + 1 < 2048)
# and makes the ancestor walk in Page.clean() terminate even if raw SQL ever
# produced a cycle behind the domain's back.
MAX_PAGE_DEPTH = 15

# The SEO document is an allowlist, never a settings dump: only these string
# keys may appear, each with a length ceiling.
SEO_KEYS = {
    "meta_title": 120,
    "meta_description": 300,
    "og_image_ref": 512,
}


def normalize_slug(value):
    """Lowercase, collapse every run of non-alphanumerics into one hyphen."""
    return re.sub(r"[^a-z0-9]+", "-", str(value).strip().lower()).strip("-")


class Page(SiteContent):
    """One Site-owned page: a node in the Site's per-locale route tree.

    Pages inherit identity, Site ownership, status, locale, authorship and
    metadata from SiteContent and add routing: a slug, a parent within the
    same Site and language, and the computed full `path` that the URL space
    treats as canonical. The tree is per locale — a translation is a sibling
    row in another language, not a property of the original (no translation
    workflow is claimed yet).
    """

    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT,
        related_name="children",
        help_text="Parent page. Must belong to the same Site and locale; "
                  "pages never move across Sites or languages and a page "
                  "can never become its own ancestor.",
    )
    title = models.CharField(
        max_length=255,
        help_text="Human-readable page title in this row's language.",
    )
    slug = models.CharField(
        max_length=128,
        validators=[RegexValidator(
            SLUG_FORMAT,
            "Use lowercase letters, digits and hyphens, such as about-us.",
        )],
        help_text="One route segment. Input is normalized (lowercased, runs "
                  "of other characters collapsed to hyphens) before "
                  "validation, mirroring hostname normalization.",
    )
    path = models.CharField(
        max_length=2048, editable=False,
        help_text="Computed full route within this Site and locale, such as "
                  "/about/people. Recomputed on every save and unique per "
                  "(site, locale).",
    )
    layout = models.CharField(
        max_length=64, blank=True, default="",
        validators=[RegexValidator(
            LAYOUT_FORMAT,
            "Use an uppercase layout code such as STANDARD or LANDING.",
        )],
        help_text="Approved layout code the rendering layer resolves; empty "
                  "uses the Site's default layout. A reference, never a "
                  "template file and never a secret.",
    )
    seo = models.JSONField(
        blank=True, default=dict,
        help_text="Allowlisted SEO object: meta_title, meta_description, "
                  "og_image_ref. Unsupported keys and non-string values are "
                  "rejected; never a place for secrets.",
    )
    visibility = models.CharField(
        max_length=9, choices=Visibility.choices, default=Visibility.PUBLIC,
        help_text="PUBLIC is served and listed, UNLISTED is served only by "
                  "its direct route, HIDDEN is never served publicly. None "
                  "of them publish a draft.",
    )
    position = models.PositiveIntegerField(
        default=0,
        help_text="Sibling ordering hint; ties are broken by id so lists are "
                  "stable.",
    )
    is_homepage = models.BooleanField(
        default=False,
        help_text="Designates the page that serves the Site root. At most "
                  "one per Site (partial unique index), maintained through "
                  "the set_as_homepage service so replacement is atomic.",
    )

    class Meta:
        ordering = ("position", "id")
        constraints = [
            # Self-parenting is refused by clean() and by the database
            # (cms_validate_page, constraint ``page_parent_not_self``). A
            # Django CheckConstraint cannot express `!= pk` here: ``id`` is
            # local to SiteContent, and a constraint referencing a parent
            # field fails the model check that `migrate` runs (models.E016).
            models.CheckConstraint(
                condition=Q(slug__regex=SLUG_FORMAT), name="page_slug_format",
            ),
            models.CheckConstraint(
                condition=Q(path__regex=PATH_FORMAT), name="page_path_format",
            ),
            models.CheckConstraint(
                condition=Q(layout="") | Q(layout__regex=LAYOUT_FORMAT),
                name="page_layout_format",
            ),
            models.CheckConstraint(
                condition=Q(visibility__in=["PUBLIC", "UNLISTED", "HIDDEN"]),
                name="page_visibility",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("seo", function="jsonb_typeof", output_field=models.CharField()),
                    Value("object"),
                ),
                name="page_seo_object",
            ),
        ]
        indexes = [
            # The Page table holds no site or locale column (they live on the
            # shared SiteContent row), so its local index leads with parent;
            # tenant scoping comes from the parent table's ownership indexes
            # and from the trigger-enforced (site, locale, path) route key —
            # see apps/cms/page_sql.py and the data-model document.
            models.Index(fields=["parent"], name="page_parent_idx"),
        ]

    def __str__(self):
        return f"{self.site_id}:{self.path or self.slug}"

    def full_clean(self, *args, **kwargs):
        if isinstance(self.slug, str):
            self.slug = normalize_slug(self.slug)
        if isinstance(self.layout, str) and self.layout.strip():
            self.layout = self.layout.strip().upper()
        return super().full_clean(*args, **kwargs)

    def clean(self):
        # Content rules first (the parent/locale checks below need the
        # normalized locale), then the page's own route/hierarchy rules, and
        # only then blocks: a block rejection must not leave route
        # normalization half-done, and the constraint checks that run after
        # clean read the instance — settled fields, no shadowing noise.
        self._validate_content()
        if not self._state.adding:
            current = (
                SiteContent.objects.using(
                    self._state.db or router.db_for_write(type(self), instance=self)
                )
                .filter(pk=self.pk)
                .values("status")
                .first()
            )
            if current and current["status"] in {
                ContentStatus.IN_REVIEW, ContentStatus.APPROVED,
                ContentStatus.PUBLISHED, ContentStatus.ARCHIVED,
            }:
                previous_page = (
                    type(self).objects.using(
                        self._state.db or router.db_for_write(type(self), instance=self)
                    )
                    .filter(pk=self.pk)
                    .values(
                        "parent_id", "title", "slug", "layout", "seo",
                        "visibility", "position", "is_homepage",
                    )
                    .first()
                )
                if previous_page and any(
                    previous_page[name] != getattr(self, name)
                    for name in (
                        "parent_id", "title", "slug", "layout", "seo",
                        "visibility", "position", "is_homepage",
                    )
                ):
                    raise ValidationError({
                        "status": "Page content is locked while in review, "
                                  "approved, published or archived.",
                    })
        if not isinstance(self.seo, dict):
            raise ValidationError({"seo": "SEO metadata must be a JSON object."})
        unknown = sorted(set(self.seo) - set(SEO_KEYS))
        if unknown:
            raise ValidationError({
                "seo": "Unsupported SEO keys: " + ", ".join(unknown)
                       + ". Approved: " + ", ".join(sorted(SEO_KEYS)) + ".",
            })
        for key, value in self.seo.items():
            if value is not None and not isinstance(value, str):
                raise ValidationError({"seo": f"{key} must be a string or null."})
            if isinstance(value, str) and len(value) > SEO_KEYS[key]:
                raise ValidationError({
                    "seo": f"{key} must be at most {SEO_KEYS[key]} characters.",
                })

        self._validate_route()
        # Blocks last, after the route is settled (see _validate_blocks):
        # a block rejection must not leave route normalization half-done,
        # and the constraint checks that run after clean read the instance —
        # settled fields, no shadowing noise.
        self._validate_blocks()

    def _validate_route(self):
        """Compute and police the page's route within its Site and locale."""
        if not self.slug or not self.site_id:
            # clean_fields already reported the missing value.
            return

        if not self._state.adding:
            previous_locale = (
                type(self).objects.filter(pk=self.pk)
                .values_list("locale", flat=True).first()
            )
            if previous_locale is not None and previous_locale != self.locale:
                raise ValidationError({
                    "locale": "Page language is fixed after creation; create "
                              "a translated page instead.",
                })

        if not self.parent_id:
            self.path = f"/{self.slug}"
            self._assert_route_is_free()
            return
        if self.parent_id == self.pk:
            raise ValidationError({"parent": "A page cannot be its own parent."})
        parent = (
            type(self).objects.filter(pk=self.parent_id)
            .only("pk", "site_id", "locale", "path", "parent_id")
            .first()
        )
        if parent is None:
            # clean_fields already reported the dangling reference.
            return
        if parent.site_id != self.site_id:
            raise ValidationError({
                "parent": "The parent must belong to the same Site.",
            })
        if parent.locale != self.locale:
            raise ValidationError({
                "parent": "The parent must be in the same language as the page.",
            })
        # The route is checked in the DB after this walk (page_sql.py) and the
        # ancestor walk runs next — derive the tentative path *now* so that a
        # cycle/depth rejection never additionally reports the (still empty)
        # computed field as violating its format constraint.
        self.path = f"{parent.path.rstrip('/')}/{self.slug}"
        # Walk the ancestor chain: reject cycles and runaway depth before the
        # path is trusted.
        seen = {self.pk}
        cursor = parent
        depth = 1
        while cursor is not None:
            if cursor.pk in seen:
                raise ValidationError({
                    "parent": "A page cannot be its own ancestor.",
                })
            seen.add(cursor.pk)
            depth += 1
            if depth > MAX_PAGE_DEPTH:
                raise ValidationError({
                    "parent": f"Page hierarchy cannot be deeper than {MAX_PAGE_DEPTH} levels.",
                })
            if cursor.parent_id is None:
                break
            cursor = (
                type(self).objects.filter(pk=cursor.parent_id)
                .only("pk", "parent_id")
                .first()
            )

        # Domain-level uniqueness: friendly errors before the database's
        # trigger backstops the same rules for racing writers (page_sql.py).
        self._assert_route_is_free()

    def _assert_route_is_free(self):
        routes = type(self).objects.filter(
            site_id=self.site_id, locale=self.locale, path=self.path,
        ).exclude(pk=self.pk)
        if routes.exists():
            raise ValidationError({
                "path": "A page with this route already exists in this Site "
                        "and language. Change the slug or the parent.",
            })
        if self.is_homepage:
            homepages = type(self).objects.filter(
                site_id=self.site_id, is_homepage=True,
            ).exclude(pk=self.pk)
            if homepages.exists():
                raise ValidationError({
                    "is_homepage": "This Site already has a homepage. Use the "
                                   "set_as_homepage service to replace it.",
                })


class PageRedirect(models.Model):
    """URL history: one former route of one Page, per Site and locale.

    Written only by the change_route service when a page's path actually
    changes, and resolved only when no live page matches the request — a live
    route always wins. Deleting the page deletes its history (CASCADE).
    """

    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="page_redirects",
    )
    page = models.ForeignKey(
        Page, on_delete=models.CASCADE, related_name="redirects",
        help_text="The page that used to answer this route. Redirects are "
                  "re-pointed when the page moves again, never chained.",
    )
    locale = models.CharField(
        max_length=35,
        validators=[RegexValidator(
            LANGUAGE_FORMAT,
            "Use a normalized language code such as en, am or en-us.",
        )],
        help_text="Language the former route belonged to.",
    )
    old_path = models.CharField(
        max_length=2048,
        help_text="The route this page used to answer.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("site_id", "locale", "old_path")
        constraints = [
            models.UniqueConstraint(
                fields=["site", "locale", "old_path"],
                name="page_redirect_route_uniq",
            ),
            models.CheckConstraint(
                condition=Q(old_path__regex=PATH_FORMAT),
                name="page_redirect_path_format",
            ),
            models.CheckConstraint(
                condition=Q(locale__regex=LANGUAGE_FORMAT),
                name="page_redirect_locale_format",
            ),
        ]

    def __str__(self):
        return f"{self.site_id}:{self.locale}:{self.old_path}->{self.page_id}"


class ContentRole(models.TextChoices):
    AUTHOR = "AUTHOR", "Author"
    REVIEWER = "REVIEWER", "Reviewer"
    PUBLISHER = "PUBLISHER", "Publisher"


class SiteContentRoleAssignment(models.Model):
    """A Site-scoped CMS role; platform-admin remains a validated token role."""

    site = models.ForeignKey(
        "sites.Site", on_delete=models.CASCADE,
        related_name="content_role_assignments",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="site_content_roles",
    )
    role = models.CharField(max_length=10, choices=ContentRole.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("site_id", "user_id", "role")
        constraints = [
            models.UniqueConstraint(
                fields=("site", "user", "role"),
                name="cms_site_content_role_uniq",
            ),
            models.CheckConstraint(
                condition=Q(role__in=ContentRole.values),
                name="cms_site_content_role_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "site", "role"),
                name="cms_content_role_lookup_idx",
            ),
        ]


class ContentWorkflowTransition(models.Model):
    """Append-only state transition history, including review feedback."""

    content = models.ForeignKey(
        SiteContent, on_delete=models.PROTECT,
        related_name="workflow_transitions",
    )
    from_status = models.CharField(max_length=11, choices=ContentStatus.choices)
    to_status = models.CharField(max_length=11, choices=ContentStatus.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [
            models.Index(
                fields=("content", "created_at"),
                name="cms_workflow_content_time_idx",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(from_status__in=ContentStatus.values),
                name="cms_workflow_from_status",
            ),
            models.CheckConstraint(
                condition=Q(to_status__in=ContentStatus.values),
                name="cms_workflow_to_status",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Workflow history is append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Workflow history is append-only.")


class PublishedContentSnapshot(models.Model):
    """Immutable version of the exact payload exposed by one publication."""

    content = models.ForeignKey(
        SiteContent, on_delete=models.PROTECT,
        related_name="publication_snapshots",
    )
    version = models.PositiveIntegerField()
    payload = models.JSONField()
    published_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        ordering = ("content_id", "-version")
        constraints = [
            models.CheckConstraint(
                condition=Exact(
                    models.Func("payload", function="jsonb_typeof", output_field=models.CharField()),
                    Value("object"),
                ),
                name="cms_published_snapshot_object",
            ),
            models.UniqueConstraint(
                fields=("content", "version"),
                name="cms_published_snapshot_version_uniq",
            ),
            models.CheckConstraint(
                condition=Q(version__gte=1),
                name="cms_published_snapshot_version_positive",
            ),
        ]
        indexes = [
            models.Index(
                fields=("content", "-version"),
                name="cms_pub_snapshot_latest_idx",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Published snapshots are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Published snapshots are immutable.")


class ContentRevision(models.Model):
    """Immutable, Site-scoped snapshot of one meaningful content save."""

    content = models.ForeignKey(
        SiteContent, on_delete=models.CASCADE, related_name="revisions",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="content_revisions",
    )
    revision_number = models.PositiveIntegerField()
    editor_identity = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=11, choices=ContentStatus.choices)
    snapshot = models.JSONField()
    changed_fields = models.JSONField(default=list)
    content_hash = models.CharField(max_length=64)
    restored_from_revision = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("content_id", "-revision_number")
        constraints = [
            models.UniqueConstraint(
                fields=("content", "revision_number"),
                name="cms_content_revision_uniq",
            ),
            models.CheckConstraint(
                condition=Q(revision_number__gte=1),
                name="cms_content_revision_positive",
            ),
            models.CheckConstraint(
                condition=Q(status__in=ContentStatus.values),
                name="cms_content_revision_status",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("snapshot", function="jsonb_typeof", output_field=models.CharField()),
                    Value("object"),
                ),
                name="cms_content_revision_snapshot_object",
            ),
            models.CheckConstraint(
                condition=Exact(
                    models.Func("changed_fields", function="jsonb_typeof", output_field=models.CharField()),
                    Value("array"),
                ),
                name="cms_content_revision_changed_array",
            ),
            models.CheckConstraint(
                condition=Q(content_hash__regex=r"\A[a-f0-9]{64}\Z"),
                name="cms_content_revision_hash",
            ),
        ]
        indexes = [
            models.Index(
                fields=("site", "content", "-revision_number"),
                name="cms_revision_site_recent_idx",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Content revisions are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Content revisions are immutable.")


class SitePublicationVersion(models.Model):
    """Monotonic cache generation for public content in a Site locale."""

    site = models.ForeignKey(
        "sites.Site", on_delete=models.CASCADE,
        related_name="cms_publication_versions",
    )
    locale = models.CharField(max_length=35)
    version = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("site", "locale"),
                name="cms_site_locale_pub_version_uniq",
            ),
            models.CheckConstraint(
                condition=Q(locale__regex=LANGUAGE_FORMAT),
                name="cms_pub_version_locale_format",
            ),
        ]
