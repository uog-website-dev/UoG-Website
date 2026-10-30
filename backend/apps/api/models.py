"""Models for the API app"""

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

from apps.cms.models import SiteContent


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


class Post(SiteContent):
    """News-like post with reusable taxonomy and structured content.

    Inherits from SiteContent to share the publishing workflow, status
    machine, and audit trail with Pages and future content types. Adds
    taxonomy (Category/Tag), featured media, author, and SEO metadata
    scoped to the owning Site.
    """

    title = models.CharField(
        max_length=255,
        help_text="Human-readable post title in this row's language.",
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

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class Category(SiteContent):
    """Site-scoped Category with stable ID, normalized slug, and uniqueness rules.

    Shares the publishing workflow with Posts and other content types.
    Slug uniqueness is enforced only on published records per (site, locale),
    so draft/category pairs may share the same slug within a Site.
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
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['slug'],
                name='category_slug_site_uniq',
                condition=models.Q(is_active=True),
            ),
        ]

    def save(self, *args, **kwargs):
        """Normalize slug from name on save."""
        if self.name:
            self.slug = self.name.lower().replace(' ', '-').replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u').replace('ñ', 'n')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Tag(SiteContent):
    """Site-scoped Tag with stable ID, normalized slug, and uniqueness rules.

    Shares the publishing workflow with Posts and other content types.
    Slug uniqueness is enforced only on published records per (site, locale),
    so draft/tag pairs may share the same slug within a Site.
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
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['slug'],
                name='tag_slug_site_uniq',
                condition=models.Q(is_active=True),
            ),
        ]

    def save(self, *args, **kwargs):
        """Normalize slug from name on save."""
        if self.name:
            self.slug = self.name.lower().replace(' ', '-').replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u').replace('ñ', 'n')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name