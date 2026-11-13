"""Models for the API app.

Page is the legacy platform page table. Post, Category and Tag are Site-owned
CMS content: they inherit identity, Site ownership, status, locale and the
shared publishing contract from :class:`apps.cms.models.SiteContent`, and add
their own natural keys. Per-Site slug uniqueness cannot be a plain database
constraint because ``site`` and ``locale`` live on the shared parent row, so
the cross-table rule is enforced by ``apps.api.taxonomy_sql`` (database
backstop) and by ``clean()`` (friendly, actionable errors).
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models

from apps.cms.models import ContentStatus, SEO_KEYS, SLUG_FORMAT, SiteContent, normalize_slug

# Permalinks under /posts/{slug}. Keep in sync with the admin Post settings UI.
RESERVED_POST_SLUGS = frozenset({
    "new",
    "edit",
    "create",
    "admin",
    "api",
    "preview",
    "feed",
    "search",
    "rss",
    "atom",
    "index",
})


class Page(models.Model):
    """Page model for storing website pages"""

    title = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    content = models.TextField()
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_published = models.BooleanField(default=False)
    site = models.ForeignKey(
        "sites.Site", null=True, blank=True, on_delete=models.PROTECT,
        related_name="pages",
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


def _validate_seo(seo):
    """Reject unsupported SEO keys, non-string values and overlong text."""
    if not isinstance(seo, dict):
        raise ValidationError({"seo": "SEO metadata must be a JSON object."})
    unknown = sorted(set(seo) - set(SEO_KEYS))
    if unknown:
        raise ValidationError({
            "seo": "Unsupported SEO keys: " + ", ".join(unknown)
                   + ". Approved: " + ", ".join(sorted(SEO_KEYS)) + ".",
        })
    for key, value in seo.items():
        if value is not None and not isinstance(value, str):
            raise ValidationError({"seo": f"{key} must be a string or null."})
        if isinstance(value, str) and len(value) > SEO_KEYS[key]:
            raise ValidationError({
                "seo": f"{key} must be at most {SEO_KEYS[key]} characters.",
            })


class Post(SiteContent):
    """News-like post with reusable taxonomy and structured content.

    Inherits the shared publishing workflow, status machine and revision
    history from SiteContent. Adds taxonomy (Category/Tag), featured media,
    author and SEO metadata scoped to the owning Site.
    """

    draft_of = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="working_drafts")

    title = models.CharField(
        max_length=255,
        help_text="Human-readable post title in this row's language.",
    )
    slug = models.CharField(
        max_length=128,
        validators=[RegexValidator(
            SLUG_FORMAT,
            "Use lowercase letters, digits and hyphens, such as campus-news.",
        )],
        help_text="URL-safe identifier, normalized from the supplied value on "
                  "save and unique per (Site, language).",
    )
    excerpt = models.TextField(
        blank=True,
        help_text="Optional summary excerpt shown on listing pages.",
    )
    content = models.TextField(
        help_text="Full rich-text body; markdown-friendly, sanitized on write.",
    )
    excerpt_html = models.TextField(
        blank=True,
        help_text="HTML-sanitized version of excerpt for rendering.",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_posts",
        help_text="Platform user who authored this post.",
    )
    featured_media = models.CharField(
        max_length=512, blank=True,
        help_text="URL or path to a featured image or video asset.",
    )
    seo = models.JSONField(
        blank=True,
        default=dict,
        help_text="Allowlisted SEO metadata: meta_title, meta_description, "
        "og_image_ref. Unsupported keys and non-string values are rejected.",
    )
    categories = models.ManyToManyField(
        "api.Category",
        blank=True,
        related_name="posts",
        help_text="Categories this post belongs to.",
    )
    tags = models.ManyToManyField(
        "api.Tag",
        blank=True,
        related_name="posts",
        help_text="Tags this post belongs to.",
    )

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_FORMAT),
                name="post_slug_format",
            ),
        ]

    def __str__(self):
        return f"{self.site_id}:{self.slug or self.title}"

    def full_clean(self, *args, **kwargs):
        if isinstance(self.slug, str):
            self.slug = normalize_slug(self.slug)
        if isinstance(self.excerpt_html, str):
            # Public clients may render this fragment as HTML, so every
            # write path must pass it through the shared rich-text allowlist.
            from apps.cms.blocks import sanitize_rich_text
            self.excerpt_html = sanitize_rich_text(self.excerpt_html)
        return super().full_clean(*args, **kwargs)

    def clean(self):
        # Normalize the versioned representation before validating the full
        # candidate against shared Site/workflow and Post-specific rules.
        # All mutations still pass full_clean before the revisioned save.
        if isinstance(self.metadata, dict) and "post_editor" in self.metadata:
            from .post_editor import normalize_document
            try:
                document = normalize_document(self.metadata["post_editor"])
            except ValidationError as error:
                raise ValidationError({"editor_document": error.messages}) from error
            self.metadata = {**self.metadata, "post_editor": document}
            self.content = document["html"]
        self._validate_content()
        from .post_media import validate_post_images
        from apps.cms.models import _workflow_write
        returning_to_draft = _workflow_write.get() and self.status == ContentStatus.DRAFT
        if self.status not in {ContentStatus.UNPUBLISHED, ContentStatus.ARCHIVED} and not returning_to_draft:
            validate_post_images(self)
        self._validate_working_draft()
        self._validate_identity_lock()
        self._validate_reserved_slug()
        _validate_seo(self.seo)
        self._validate_slug_is_free()
        self._validate_blocks()

    def save(self, *args, taxonomy=None, **kwargs):
        if taxonomy and kwargs.get("update_fields") is not None:
            raise ValueError("Post taxonomy requires a complete revisioned save.")
        self._pending_taxonomy = {field: list(terms) for field, terms in (taxonomy or {}).items()}
        try:
            return super().save(*args, **kwargs)
        finally:
            del self._pending_taxonomy

    def _save_revision_relations(self, *, using):
        for field, terms in self._pending_taxonomy.items():
            model = Category if field == "categories" else Tag
            identifiers = {term.pk for term in terms}
            rows = list(
                model.objects.using(using).select_for_update()
                .filter(pk__in=identifiers, site_id=self.site_id, is_active=True)
                .order_by("pk")
            )
            if len(rows) != len(identifiers):
                raise ValidationError({field: "Select active taxonomy owned by this Site."})
            relation = getattr(self, field)
            from apps.cms.models import _apply_working_draft
            editable = self.status in {ContentStatus.DRAFT, ContentStatus.UNPUBLISHED} or _apply_working_draft.get()
            if not editable and set(relation.values_list("pk", flat=True)) != identifiers:
                raise ValidationError({field: "Return the Post to draft before changing taxonomy."})
            relation.set(rows)

    def _validate_working_draft(self):
        if not self.draft_of_id:
            return
        target = type(self).objects.filter(pk=self.draft_of_id).first()
        if target is None or target.pk == self.pk or target.draft_of_id or target.site_id != self.site_id or target.locale != self.locale:
            raise ValidationError({"draft_of": "A working draft must target an original Post on the same Site and language."})
        previous = type(self).objects.filter(pk=self.pk).values_list("draft_of_id",flat=True).first()
        if not self._state.adding and previous != self.draft_of_id:
            raise ValidationError({"draft_of": "The published article link is immutable."})
        if self._state.adding and target.status != ContentStatus.PUBLISHED:
            raise ValidationError({"draft_of": "Open a working draft from a published Post."})
        if self.status != ContentStatus.ARCHIVED and type(self).objects.filter(draft_of_id=self.draft_of_id).exclude(pk=self.pk).exclude(status=ContentStatus.ARCHIVED).exists():
            raise ValidationError({"draft_of": "This article already has an active working draft."})

    def _validate_reserved_slug(self):
        if self.slug and self.slug in RESERVED_POST_SLUGS:
            raise ValidationError({
                "slug": f'"{self.slug}" is reserved and cannot be used as a Post permalink.',
            })

    def _validate_identity_lock(self):
        """Keep published (and review) identity stable until workflow unlocks it.

        Public listing/detail resolve the live Post row then serve the publication
        snapshot. Mutating title/slug/excerpt while published would move the public
        route or diverge from the frozen snapshot without a new publish.
        """
        from apps.cms.models import _apply_working_draft
        if self._state.adding or _apply_working_draft.get():
            return
        from django.db import router
        previous = (
            type(self).objects.using(
                self._state.db or router.db_for_write(type(self), instance=self)
            )
            .filter(pk=self.pk)
            .values(
                "status", "title", "slug", "excerpt", "content",
                "featured_media", "seo", "excerpt_html", "author_id",
            )
            .first()
        )
        if not previous:
            return
        if previous["status"] not in {
            ContentStatus.IN_REVIEW, ContentStatus.APPROVED,
            ContentStatus.PUBLISHED, ContentStatus.ARCHIVED,
        }:
            return
        locked = (
            "title", "slug", "excerpt", "content", "featured_media", "seo", "excerpt_html", "author_id",
        )
        if any(previous[name] != getattr(self, name) for name in locked):
            raise ValidationError({
                "status": "Post title, permalink, summary and body are locked while "
                          "in review, approved, published or archived. Return the Post "
                          "to draft through the workflow before changing them.",
            })

    def _validate_slug_is_free(self):
        """Refuse a duplicate slug in the same Site and language.

        ``Post`` is a multi-table child of SiteContent, so ``site`` and
        ``locale`` are parent columns and no Django UniqueConstraint can
        span both tables. ``apps.api.taxonomy_sql`` backstops this check for
        racing writers; this method exists so the caller gets a field error
        instead of a database error.
        """
        if not self.slug or not self.site_id:
            return
        duplicates = type(self).objects.filter(
            site_id=self.site_id, locale=self.locale, slug=self.slug,
        ).exclude(pk=self.pk)
        if duplicates.exists():
            raise ValidationError({
                "slug": "A post with this slug already exists in this Site "
                        "and language. Choose a different slug.",
            })


class Category(SiteContent):
    """Site-scoped Category with stable ID, normalized slug and uniqueness rules.

    Shares the publishing workflow with Posts and other content types. Slug
    uniqueness is enforced only on active records per (site, locale), so
    inactive categories may reuse a slug within a Site.
    """

    code = models.CharField(
        max_length=64,
        validators=[
            RegexValidator(
                r"^[A-Z][A-Z0-9_-]{0,63}$",
                "Use an uppercase letter followed by uppercase letters, digits, "
                "underscores or hyphens.",
            )
        ],
        help_text="Stable identifier used in URLs and feeds; never changed.",
    )
    name = models.CharField(max_length=255)
    slug = models.SlugField(
        max_length=128,
        help_text="URL-safe identifier, normalized from name on save.",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive categories keep their rows but release their "
                  "slug for reuse within the Site.",
    )

    class Meta:
        ordering = ['name']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_FORMAT),
                name="category_slug_format",
            ),
        ]

    def full_clean(self, *args, **kwargs):
        if isinstance(self.slug, str):
            self.slug = normalize_slug(self.slug)
        if self.name and not self.slug:
            self.slug = normalize_slug(self.name)
        return super().full_clean(*args, **kwargs)

    def clean(self):
        self._validate_content()
        self._validate_active_slug_is_free()
        self._validate_blocks()

    def _validate_active_slug_is_free(self):
        if not self.slug or not self.site_id or not self.is_active:
            return
        duplicates = type(self).objects.filter(
            site_id=self.site_id, locale=self.locale, slug=self.slug,
            is_active=True,
        ).exclude(pk=self.pk)
        if duplicates.exists():
            raise ValidationError({
                "slug": "An active category with this slug already exists in "
                        "this Site and language. Deactivate it or choose a "
                        "different name.",
            })

    def __str__(self):
        return self.name


class Tag(SiteContent):
    """Site-scoped Tag with stable ID, normalized slug and uniqueness rules.

    Shares the publishing workflow with Posts and other content types. Slug
    uniqueness is enforced only on active records per (site, locale), so
    inactive tags may reuse a slug within a Site.
    """

    code = models.CharField(
        max_length=64,
        validators=[
            RegexValidator(
                r"^[A-Z][A-Z0-9_-]{0,63}$",
                "Use an uppercase letter followed by uppercase letters, digits, "
                "underscores or hyphens.",
            )
        ],
        help_text="Stable identifier used in URLs and feeds; never changed.",
    )
    name = models.CharField(max_length=255)
    slug = models.SlugField(
        max_length=128,
        help_text="URL-safe identifier, normalized from name on save.",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive tags keep their rows but release their slug for "
                  "reuse within the Site.",
    )

    class Meta:
        ordering = ['name']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(slug__regex=SLUG_FORMAT),
                name="tag_slug_format",
            ),
        ]

    def full_clean(self, *args, **kwargs):
        if isinstance(self.slug, str):
            self.slug = normalize_slug(self.slug)
        if self.name and not self.slug:
            self.slug = normalize_slug(self.name)
        return super().full_clean(*args, **kwargs)

    def clean(self):
        self._validate_content()
        self._validate_active_slug_is_free()
        self._validate_blocks()

    def _validate_active_slug_is_free(self):
        if not self.slug or not self.site_id or not self.is_active:
            return
        duplicates = type(self).objects.filter(
            site_id=self.site_id, locale=self.locale, slug=self.slug,
            is_active=True,
        ).exclude(pk=self.pk)
        if duplicates.exists():
            raise ValidationError({
                "slug": "An active tag with this slug already exists in this "
                        "Site and language. Deactivate it or choose a "
                        "different name.",
            })

    def __str__(self):
        return self.name
