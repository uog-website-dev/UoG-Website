"""Site-owned menus: one location per Site, items as an ordered tree.

Internal page and post targets belong to the same Site. A cross-site target
is stored only when allow_cross_site is set. External targets accept http
and https URLs and reject scriptable schemes, protocol-relative URLs, and
credentialed redirects. Editing is refused while the MENUS module is off;
existing rows are left in place.
"""
import re
import uuid
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator, URLValidator
from django.db import models, router
from django.db.models import Q
from apps.organizations.hierarchy_lock import hierarchy_write

LOCATION_FORMAT = r"\A[a-z][a-z0-9-]{0,31}\Z"
CUSTOM_PATH = re.compile(r"\A/(?:[a-z0-9][a-z0-9-]{0,63}(?:/[a-z0-9][a-z0-9-]{0,63})*)?\Z")
MAX_MENU_DEPTH = 4
EXTERNAL_SCHEMES = frozenset({"http", "https"})
REJECTED_SCHEMES = frozenset({"javascript", "data", "vbscript", "file"})
MENU_LOCATIONS = ("header", "footer", "sidebar", "primary", "secondary")
LOCAL_PRECEDENCE = ("override", "append")
MAX_INHERITANCE_HOPS = 8


class MenuQuerySet(models.QuerySet):
    """Acquire the same guard as raw SQL before taking row locks."""

    def update(self, **kwargs):
        with hierarchy_write(using=self.db):
            return super().update(**kwargs)

    def bulk_create(self, objs, **kwargs):
        with hierarchy_write(using=self.db):
            return super().bulk_create(objs, **kwargs)

    def bulk_update(self, objs, fields, **kwargs):
        with hierarchy_write(using=self.db):
            return super().bulk_update(objs, fields, **kwargs)

    def delete(self):
        with hierarchy_write(using=self.db):
            return super().delete()


class MenuRecord(models.Model):
    objects = MenuQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            self.full_clean()
            if kwargs.get("update_fields"):
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"updated_at"}
            result = super().save(*args, **kwargs)
            if hasattr(self, "version"):
                self.refresh_from_db(using=using, fields=["version", "updated_at"])
            return result

    def delete(self, *args, **kwargs):
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            require_menus_module(self.site_id, using=using)
            return super().delete(*args, **kwargs)


class Menu(MenuRecord):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="menus")
    location = models.CharField(
        max_length=32,
        validators=[RegexValidator(LOCATION_FORMAT, "Use a location key such as header or footer.")],
        help_text="Site-scoped location such as header or footer. One live key per Site.",
    )
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    is_global = models.BooleanField(
        default=False,
        help_text="Centrally governed fragment. Only the main Site may own one, and only one global menu exists per location.",
    )
    version = models.PositiveBigIntegerField(default=0, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("site_id", "location", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("site", "location"),
                condition=Q(is_global=False),
                name="menu_site_location_uniq",
            ),
            models.UniqueConstraint(
                fields=("location",),
                condition=Q(is_global=True),
                name="menu_global_location_uniq",
            ),
            models.CheckConstraint(condition=Q(location__regex=LOCATION_FORMAT), name="menu_location_format"),
            models.CheckConstraint(condition=~Q(name=""), name="menu_name_required"),
            models.CheckConstraint(condition=Q(location__in=MENU_LOCATIONS), name="menu_configured_location"),
        ]
        indexes = [models.Index(fields=["site", "location"], name="menu_site_location_idx")]

    def full_clean(self, *args, **kwargs):
        if isinstance(self.location, str):
            self.location = self.location.strip().lower()
        if isinstance(self.name, str):
            self.name = self.name.strip()
        return super().full_clean(*args, **kwargs)

    def clean(self):
        super().clean()
        if not self.name:
            raise ValidationError({"name": "A menu name is required."})
        if self.location not in MENU_LOCATIONS:
            raise ValidationError({"location": "Choose a configured menu location."})
        if self.pk and not self._state.adding:
            previous = type(self).objects.filter(pk=self.pk).values_list("site_id", flat=True).first()
            if previous is not None and previous != self.site_id:
                raise ValidationError({"site": "A menu cannot move to another Site."})
        if self.is_global:
            from apps.sites.models import Site
            if not Site.objects.filter(pk=self.site_id, is_main=True).exists():
                raise ValidationError({"is_global": "A global menu belongs to the main Site."})
        require_menus_module(self.site_id)

    def save(self, *args, **kwargs):
        previous = None
        if not self._state.adding:
            previous = type(self).objects.filter(pk=self.pk).values("site_id", "location", "is_global").first()
        result = super().save(*args, **kwargs)
        from .menu_cache import invalidate_menu_state
        invalidate_menu_state(self.site_id, self.location, self.is_global)
        if previous and (
            previous["site_id"], previous["location"], previous["is_global"],
        ) != (self.site_id, self.location, self.is_global):
            invalidate_menu_state(previous["site_id"], previous["location"], previous["is_global"])
        return result

    def delete(self, *args, **kwargs):
        site_id, location, is_global = self.site_id, self.location, self.is_global
        result = super().delete(*args, **kwargs)
        from .menu_cache import invalidate_menu_state
        invalidate_menu_state(site_id, location, is_global)
        return result

class MenuItem(MenuRecord):
    class ItemType(models.TextChoices):
        PAGE = "page", "Page"
        POST = "post", "Post"
        EXTERNAL = "external", "External"
        CUSTOM = "custom", "Custom"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    menu = models.ForeignKey(Menu, on_delete=models.PROTECT, related_name="items")
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="menu_items")
    label = models.CharField(max_length=255)
    item_type = models.CharField(max_length=8, choices=ItemType.choices)
    page = models.ForeignKey("cms.Page", null=True, blank=True, on_delete=models.PROTECT, related_name="menu_items")
    post = models.ForeignKey("api.Post", null=True, blank=True, on_delete=models.PROTECT, related_name="menu_items")
    target = models.CharField(max_length=2048, blank=True, default="")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    allow_cross_site = models.BooleanField(
        default=False,
        help_text="Explicit opt-in for a page or post owned by a different Site. External and custom targets cannot set this.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("sort_order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("menu", "parent", "sort_order"),
                name="menu_item_sibling_order",
                nulls_distinct=False,
                deferrable=models.Deferrable.IMMEDIATE,
            ),
            models.CheckConstraint(condition=Q(label__gt=""), name="menu_item_label_required"),
            models.CheckConstraint(condition=Q(item_type__in=["page", "post", "external", "custom"]), name="menu_item_type"),
            models.CheckConstraint(condition=Q(sort_order__gte=0), name="menu_item_sort_order"),
            models.CheckConstraint(
                condition=~Q(target__contains="://") | Q(item_type="external"),
                name="menu_item_target_scheme",
            ),
        ]
        indexes = [models.Index(fields=["menu", "parent", "sort_order"], name="menu_item_order_idx")]

    def clean(self):
        super().clean()
        if isinstance(self.label, str):
            self.label = self.label.strip()
        if not self.label:
            raise ValidationError({"label": "A menu item label is required."})
        if self.menu_id and self.site_id and Menu.objects.filter(pk=self.menu_id).values_list("site_id", flat=True).first() != self.site_id:
            raise ValidationError({"site": "A menu item must belong to its menu's Site."})
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values("menu_id", "site_id").first()
            if previous and (previous["menu_id"] != self.menu_id or previous["site_id"] != self.site_id):
                raise ValidationError({"menu": "A menu item cannot move to another menu or Site."})
        require_menus_module(self.site_id)
        self._validate_target()
        self._validate_tree()
        sibling = type(self).objects.filter(
            menu_id=self.menu_id, parent_id=self.parent_id, sort_order=self.sort_order,
        ).exclude(pk=self.pk)
        if self.menu_id and sibling.exists():
            raise ValidationError({"sort_order": "Sibling items need a unique sort order."})

    def _validate_target(self):
        kind = self.item_type
        if kind == self.ItemType.PAGE:
            if self.post_id or self.target or self.page_id is None:
                raise ValidationError({"target": "A page item targets one Page and no URL."})
            from .models import Page
            self._validate_internal(Page, self.page_id, "page")
            return
        if kind == self.ItemType.POST:
            if self.page_id or self.target or self.post_id is None:
                raise ValidationError({"target": "A post item targets one Post and no URL."})
            from apps.api.models import Post
            self._validate_internal(Post, self.post_id, "post")
            return
        if self.page_id or self.post_id or self.allow_cross_site:
            raise ValidationError({"target": "External and custom items cannot reference a Page, Post, or another Site."})
        if kind == self.ItemType.EXTERNAL:
            validate_external_url(self.target)
            return
        if kind == self.ItemType.CUSTOM:
            if not CUSTOM_PATH.match(self.target or ""):
                raise ValidationError({"target": "A custom target must be a same-site path such as / or /about."})
            return
        raise ValidationError({"item_type": "Unknown menu item type."})

    def _validate_internal(self, model, record_id, field):
        owner = model.objects.filter(pk=record_id).values_list("site_id", flat=True).first()
        if owner is None:
            raise ValidationError({field: "The target must belong to a Site."})
        if owner != self.site_id and not self.allow_cross_site:
            raise ValidationError({
                field: "The target must belong to this Site. Set allow_cross_site to link another Site's record.",
            })

    def _validate_tree(self):
        if self.parent_id == self.pk:
            raise ValidationError({"parent": "A menu item cannot be its own parent."})
        parents = dict(type(self).objects.filter(menu_id=self.menu_id).values_list("pk", "parent_id"))
        if self.parent_id is not None and self.parent_id not in parents:
            raise ValidationError({"parent": "The parent must belong to this menu."})
        parents[self.pk] = self.parent_id
        # Validate the proposed graph, including every descendant of a moved node.
        for node in parents:
            seen = set()
            while node is not None:
                if node in seen:
                    raise ValidationError({"parent": "A menu item cannot be its own ancestor."})
                seen.add(node)
                if len(seen) > MAX_MENU_DEPTH:
                    raise ValidationError({"parent": f"Menu items cannot be nested deeper than {MAX_MENU_DEPTH} levels."})
                node = parents.get(node)

    def save(self, *args, **kwargs):
        result = super().save(*args, **kwargs)
        state = Menu.objects.filter(pk=self.menu_id).values("site_id", "location", "is_global").first()
        if state:
            from .menu_cache import invalidate_menu_state
            invalidate_menu_state(state["site_id"], state["location"], state["is_global"])
        return result

    def delete(self, *args, **kwargs):
        state = Menu.objects.filter(pk=self.menu_id).values("site_id", "location", "is_global").first()
        result = super().delete(*args, **kwargs)
        if state:
            from .menu_cache import invalidate_menu_state
            invalidate_menu_state(state["site_id"], state["location"], state["is_global"])
        return result


def require_menus_module(site_id, *, using="default"):
    """Refuse the write when MENUS is off. Callers do not delete the row."""
    if not site_id:
        raise ValidationError({"site": "A menu belongs to one Site."})
    from apps.sites.selectors.modules import module_is_available
    if not module_is_available(site_id, "MENUS", using=using):
        raise ValidationError({"module": "The MENUS module is not enabled for this Site."})


def validate_external_url(value):
    """Allow http(s) URLs and reject scriptable or redirect-smuggling values."""
    if not isinstance(value, str) or not value or any(ord(char) <= 32 or ord(char) == 127 or char == "\\" for char in value):
        raise ValidationError({"target": "The external URL is not a safe http(s) address."})
    if value.startswith("//"):
        raise ValidationError({"target": "Protocol-relative URLs are not allowed."})
    if re.search(r"%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|25)", value, re.I) or re.search(r"%(?![0-9a-f]{2})", value, re.I):
        raise ValidationError({"target": "Encoded controls and ambiguous escaping are not allowed."})
    try:
        URLValidator(schemes=["http", "https"])(value)
        parts = urlsplit(value)
        parts.port  # Also rejects non-numeric or out-of-range ports.
    except (ValueError, ValidationError):
        raise ValidationError({"target": "The external URL is not a safe http(s) address."}) from None
    scheme = (parts.scheme or "").lower()
    if scheme in REJECTED_SCHEMES or scheme not in EXTERNAL_SCHEMES:
        raise ValidationError({"target": "External URLs must use http or https."})
    if parts.username or parts.password or "@" in parts.netloc:
        raise ValidationError({"target": "External URLs cannot embed credentials."})
    if not parts.hostname:
        raise ValidationError({"target": "The external URL is not a safe http(s) address."})


class MenuInheritance(models.Model):
    """Explicit per-location delivery policy. Absence means local menu only."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="menu_inheritance")
    location = models.CharField(max_length=32, validators=[RegexValidator(LOCATION_FORMAT, "Use a location key such as header or footer.")])
    inherit_from = models.ForeignKey(
        "sites.Site", null=True, blank=True, on_delete=models.PROTECT, related_name="menu_heirs",
        help_text="Optional parent Site. Public delivery copies that Site's own active local menu, not its inherited items.",
    )
    include_global = models.BooleanField(default=False)
    local_precedence = models.CharField(max_length=8, default="override")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("site", "location"), name="menu_inheritance_site_location_uniq"),
            models.CheckConstraint(condition=Q(location__in=MENU_LOCATIONS), name="menu_inheritance_location"),
            models.CheckConstraint(condition=Q(local_precedence__in=LOCAL_PRECEDENCE), name="menu_inheritance_precedence"),
        ]

    def full_clean(self, *args, **kwargs):
        if isinstance(self.location, str):
            self.location = self.location.strip().lower()
        return super().full_clean(*args, **kwargs)

    def clean(self):
        super().clean()
        if self.location not in MENU_LOCATIONS:
            raise ValidationError({"location": "Choose a configured menu location."})
        if self.local_precedence not in LOCAL_PRECEDENCE:
            raise ValidationError({"local_precedence": "Choose override or append."})
        if self.inherit_from_id is not None and self.inherit_from_id == self.site_id:
            raise ValidationError({"inherit_from": "A Site cannot inherit its own menu."})
        if self.inherit_from_id is not None:
            seen = {self.site_id}
            current = self.inherit_from_id
            hops = 0
            while current is not None:
                if current in seen:
                    raise ValidationError({"inherit_from": "Menu inheritance cannot loop."})
                seen.add(current)
                hops += 1
                if hops > MAX_INHERITANCE_HOPS:
                    raise ValidationError({"inherit_from": "Menu inheritance cannot loop."})
                current = type(self).objects.filter(
                    site_id=current, location=self.location,
                ).values_list("inherit_from_id", flat=True).first()
        require_menus_module(self.site_id)

    def save(self, *args, **kwargs):
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with hierarchy_write(using=using):
            self.full_clean()
            result = super().save(*args, **kwargs)
            from .menu_cache import invalidate_delivery
            invalidate_delivery(self.site_id, self.location)
        return result


class MenuDeliveryVersion(models.Model):
    """Per-Site, per-location generation for the public menu cache."""

    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="menu_delivery_versions")
    location = models.CharField(max_length=32)
    version = models.PositiveBigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("site", "location"), name="menu_delivery_version_uniq"),
            models.CheckConstraint(condition=Q(location__in=MENU_LOCATIONS), name="menu_delivery_version_location"),
        ]
