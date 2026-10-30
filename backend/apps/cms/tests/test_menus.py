"""Site-owned menu trees: order, depth, targets, and the MENUS module gate."""
import pytest
from django.core.exceptions import ValidationError
from django.db import connection
from django.db.migrations.loader import MigrationLoader

from apps.api.models import Post
from apps.cms.menu_models import MAX_MENU_DEPTH, Menu, MenuItem
from apps.cms.services.pages import create_page
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def ready(sites):
    module, _ = Module.objects.get_or_create(
        code="MENUS", defaults={"name": "Menus", "status": "IMPLEMENTED", "description": "Site menu trees."},
    )
    module.is_enabled = True
    module.save(update_fields=("is_enabled",))
    enable_module_for_site(sites[0].pk, module.pk)
    enable_module_for_site(sites[1].pk, module.pk)
    return sites


def test_locations_belong_to_one_site_and_items_keep_sibling_order(ready):
    site, other = ready
    header = Menu.objects.create(site=site, location="Header", name="Header")
    footer = Menu.objects.create(site=site, location="footer", name="Footer")
    assert header.location == "header"
    assert list(site.menus.values_list("location", flat=True)) == ["footer", "header"]
    with pytest.raises(ValidationError):
        Menu.objects.create(site=site, location="header", name="Second header")
    header.site = other
    with pytest.raises(ValidationError):
        header.save()
    header.refresh_from_db()
    assert header.site_id == site.pk

    later = _item(header, "Later", sort_order=2)
    first = _item(header, "First", sort_order=0)
    middle = _item(header, "Middle", sort_order=1)
    child_b = _item(header, "Child B", parent=first, sort_order=1)
    child_a = _item(header, "Child A", parent=first, sort_order=0)
    assert list(header.items.filter(parent__isnull=True).values_list("label", flat=True)) == ["First", "Middle", "Later"]
    assert list(first.children.values_list("id", flat=True)) == [child_a.pk, child_b.pk]
    assert list(header.items.values_list("id", flat=True)) == list(header.items.order_by("sort_order", "id").values_list("id", flat=True))
    with pytest.raises(ValidationError):
        _item(header, "Duplicate", sort_order=0)
    assert footer.items.count() == 0


def test_cycles_and_excessive_depth_are_rejected(ready):
    site, _other = ready
    menu = Menu.objects.create(site=site, location="header", name="Header")
    root = _item(menu, "Root")
    cursor = root
    for level in range(2, MAX_MENU_DEPTH + 1):
        cursor = _item(menu, f"Level {level}", parent=cursor)
    with pytest.raises(ValidationError) as too_deep:
        _item(menu, "Too deep", parent=cursor)
    assert "deeper" in str(too_deep.value)
    root.parent = root
    with pytest.raises(ValidationError) as own_parent:
        root.save()
    assert "own parent" in str(own_parent.value)
    root.refresh_from_db()
    child = root.children.get()
    root.parent = child
    with pytest.raises(ValidationError) as cycle:
        root.save()
    assert "ancestor" in str(cycle.value)
    root.refresh_from_db()
    assert root.parent_id is None
    assert menu.items.count() == MAX_MENU_DEPTH


def test_internal_targets_stay_on_the_site_unless_cross_site_is_explicit(ready):
    site, other = ready
    menu = Menu.objects.create(site=site, location="header", name="Header")
    local_page = create_page(site=site, title="About", slug="about")
    foreign_page = create_page(site=other, title="Foreign", slug="foreign")
    local_post = Post.objects.create(site=site, title="News", slug="news", content="News")
    foreign_post = Post.objects.create(site=other, title="Other", slug="other", content="Other")
    unscoped = Post.objects.create(title="Loose", slug="loose", content="Loose")

    linked = _item(menu, "About", item_type=MenuItem.ItemType.PAGE, page=local_page)
    assert linked.page_id == local_page.pk
    _item(menu, "News", item_type=MenuItem.ItemType.POST, post=local_post, sort_order=1)
    with pytest.raises(ValidationError) as blocked_page:
        _item(menu, "Foreign page", item_type=MenuItem.ItemType.PAGE, page=foreign_page, sort_order=2)
    assert "allow_cross_site" in str(blocked_page.value)
    with pytest.raises(ValidationError):
        _item(menu, "Foreign post", item_type=MenuItem.ItemType.POST, post=foreign_post, sort_order=2)
    with pytest.raises(ValidationError):
        _item(menu, "Loose", item_type=MenuItem.ItemType.POST, post=unscoped, sort_order=2)

    allowed = _item(
        menu, "Shared", item_type=MenuItem.ItemType.PAGE, page=foreign_page,
        allow_cross_site=True, sort_order=2,
    )
    assert allowed.page.site_id == other.pk
    assert menu.items.count() == 3


@pytest.mark.parametrize("target", [
    "javascript:alert(1)",
    "data:text/html,hi",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/path",
    "https://user:secret@example.com/path",
    "https://example.com/path\r\nLocation: https://evil.example",
    "http://example.com/a b",
])
def test_external_urls_reject_unsafe_schemes_and_redirects(ready, target):
    site, _other = ready
    menu = Menu.objects.create(site=site, location="header", name="Header")
    with pytest.raises(ValidationError):
        _item(menu, "Away", item_type=MenuItem.ItemType.EXTERNAL, target=target)
    safe = _item(menu, "Away", item_type=MenuItem.ItemType.EXTERNAL, target="https://example.com/about")
    assert safe.target == "https://example.com/about"
    with pytest.raises(ValidationError):
        _item(menu, "Path", item_type=MenuItem.ItemType.CUSTOM, target="https://example.com", sort_order=1)
    custom = _item(menu, "Path", item_type=MenuItem.ItemType.CUSTOM, target="/about", sort_order=1)
    assert custom.target == "/about"


def test_disabling_menus_blocks_edits_and_keeps_rows(ready):
    site, _other = ready
    menu = Menu.objects.create(site=site, location="header", name="Header")
    item = _item(menu, "About", item_type=MenuItem.ItemType.CUSTOM, target="/about")
    module = Module.objects.get(code="MENUS")
    enablement = site.site_modules.get(module=module)
    enablement.is_enabled = False
    enablement.save(update_fields=["is_enabled"])

    menu.name = "Renamed"
    with pytest.raises(ValidationError) as menu_error:
        menu.save()
    item.label = "Changed"
    with pytest.raises(ValidationError) as item_error:
        item.save()
    assert "MENUS" in str(menu_error.value)
    assert "MENUS" in str(item_error.value)
    menu.refresh_from_db()
    item.refresh_from_db()
    assert menu.name == "Header"
    assert item.label == "About"
    assert Menu.objects.filter(pk=menu.pk).count() == 1
    assert MenuItem.objects.filter(pk=item.pk).count() == 1


def test_menu_migration_ships_the_module_without_enabling_it():
    loader = MigrationLoader(connection, ignore_no_migrations=True)
    migration = loader.disk_migrations[("cms", "0008_menu_menuitem")]
    assert ("cms", "0008_menu_menuitem") in loader.applied_migrations
    assert ("cms", "0007_sitepublicationversion_pages_module") in migration.dependencies
    assert ("api", "0004_category_tag_post_category_category_slug_site_uniq_and_more") in migration.dependencies
    assert any(type(operation).__name__ == "RunSQL" for operation in migration.operations)
    module = Module.objects.get(code="MENUS")
    assert module.status == "IMPLEMENTED"
    assert module.is_enabled is False
    assert "menu_site_location_uniq" in {constraint.name for constraint in Menu._meta.constraints}
    assert "menu_item_sibling_order" in {constraint.name for constraint in MenuItem._meta.constraints}


def _item(menu, label, **overrides):
    values = {
        "menu": menu,
        "site": menu.site,
        "label": label,
        "item_type": MenuItem.ItemType.CUSTOM,
        "target": "/",
        "sort_order": 0,
    }
    values.update(overrides)
    if values["item_type"] in {MenuItem.ItemType.PAGE, MenuItem.ItemType.POST} and "target" not in overrides:
        values["target"] = ""
    return MenuItem.objects.create(**values)
