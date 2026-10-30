"""Models for the API app"""

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models


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


class Post(models.Model):
    """Post model for news-like content, Site-scoped with taxonomy"""
    title = models.CharField(max_length=255)
    slug = models.SlugField()
    excerpt = models.TextField(blank=True)
    content = models.TextField()
    excerpt_html = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_published = models.BooleanField(default=False)
    site = models.ForeignKey(
        "sites.Site", null=True, blank=True, on_delete=models.PROTECT,
        related_name="posts",
    )
    category = models.ForeignKey(
        "api.Category", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="posts",
    )
    tag = models.ForeignKey(
        "api.Tag", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="posts",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="authored_posts",
    )

    class Meta:
        ordering = ['-created_at']
        unique_together = [['slug', 'site']]

    def __str__(self):
        return self.title


class Category(models.Model):
    """Site-scoped Category with stable ID, normalized slug, and uniqueness rules"""
    code = models.CharField(max_length=64, validators=[
        RegexValidator(
            r"^[A-Z][A-Z0-9_-]{0,63}$",
            "Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens.",
        )
    ])
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=128, unique=False)
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="categories",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['slug', 'site'],
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


class Tag(models.Model):
    """Site-scoped Tag with stable ID, normalized slug, and uniqueness rules"""
    code = models.CharField(max_length=64, validators=[
        RegexValidator(
            r"^[A-Z][A-Z0-9_-]{0,63}$",
            "Use an uppercase letter followed by uppercase letters, digits, underscores or hyphens.",
        )
    ])
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=128, unique=False)
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="tags",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['slug', 'site'],
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