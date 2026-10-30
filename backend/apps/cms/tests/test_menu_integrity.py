"""Regression tests for raw writes, authorization, subtree moves and races."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.management import call_command
from django.db import IntegrityError, close_old_connections, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test.utils import CaptureQueriesContext

from apps.api.models import Post
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.menu_models import Menu, MenuItem, validate_external_url
from apps.cms.selectors.menus import menu_tree
from apps.cms.services.menus import create_menu, create_menu_item, update_menu_item, update_menu, menu_etag
from apps.cms.services.pages import create_page
from apps.cms.tests.test_menus import _item, ready  # noqa: F401
from apps.sites.models import Module

pytestmark = pytest.mark.django_db


@pytest.fixture
def editor(ready):
    call_command("seed_rbac", verbosity=0)
    site = ready[0]
    user = get_user_model().objects.create_user(username="menu-site-admin")
    UserRoleAssignment.objects.create(
        user=user, role=Role.objects.get(code="site-administrator"),
        scope="SITE", organization=site.organization_unit, site=site,
    )
    return user


def test_subtree_move_validates_descendant_depth(ready):
    menu = Menu.objects.create(site=ready[0], name="Header", location="header")
    root = _item(menu, "root")
    child = _item(menu, "child", parent=root)
    leaf = _item(menu, "leaf", parent=child)
    other = _item(menu, "other", sort_order=1)
    deep = _item(menu, "deep", parent=other)
    root.parent = deep
    with pytest.raises(ValidationError, match="deeper"):
        root.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        MenuItem.objects.filter(pk=root.pk).update(parent=deep)
    root.refresh_from_db()
    assert root.parent_id is None
    assert leaf.parent_id == child.pk


def test_raw_cycle_parent_ownership_and_internal_target_integrity(ready):
    site, other = ready
    menu = Menu.objects.create(site=site, name="Header", location="header")
    foreign_menu = Menu.objects.create(site=other, name="Header", location="header")
    root = _item(menu, "root")
    child = _item(menu, "child", parent=root)
    foreign_parent = _item(foreign_menu, "other")
    post = Post.objects.create(site=other, title="Foreign", slug="foreign", content="text")
    page = create_page(site=other, title="Foreign", slug="foreign")
    for changes in (
        {"parent": root}, {"parent": child}, {"parent": foreign_parent},
        {"site": other}, {"item_type": "post", "target": "", "post": post},
        {"item_type": "page", "target": "", "page": page},
        {"item_type": "page", "target": "", "page": page, "post": post, "allow_cross_site": True},
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            MenuItem.objects.filter(pk=root.pk).update(**changes)
    with pytest.raises(IntegrityError), transaction.atomic():
        Menu.objects.filter(pk=menu.pk).update(site=other)
    with pytest.raises(IntegrityError), transaction.atomic():
        MenuItem.objects.bulk_create([
            MenuItem(menu=menu, site=other, label="bad", item_type="custom", target="/", sort_order=2),
        ])
    with pytest.raises(IntegrityError), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("UPDATE cms_menuitem SET parent_id=id WHERE id=%s", [root.pk])


@pytest.mark.parametrize("url", [
    "https://example.com/%0d%0aLocation:evil", "https://example.com/%00", "https://example.com/%250a",
    "https://example.com/%5c/evil", "https://example.com/%", "https://example.com:99999/path",
    "https://user@example.com", "javascript:alert(1)", "data:text/html,bad",
    "//example.com", "https://example.com/\x1f", "https://example.com/\x7f", "https://example.com\\@evil.com",
    "https://[invalid", "https://example.com:abc", " https://example.com",
])
def test_unsafe_urls_fail_model_and_database_validation(ready, url):
    with pytest.raises(ValidationError):
        validate_external_url(url)
    menu = Menu.objects.create(site=ready[0], location="header", name="Header")
    item = _item(menu, "external", item_type="external", target="https://example.com")
    with pytest.raises(IntegrityError), transaction.atomic():
        MenuItem.objects.filter(pk=item.pk).update(target=url)


def test_disabled_module_denies_all_mutations_but_retains_records(ready):
    site = ready[0]
    menu = Menu.objects.create(site=site, name="Header", location="header")
    item = _item(menu, "item")
    site.site_modules.filter(module__code="MENUS").update(is_enabled=False)
    for operation in (
        lambda: Menu.objects.filter(pk=menu.pk).update(name="Changed"),
        lambda: MenuItem.objects.filter(pk=item.pk).update(is_active=False),
        lambda: MenuItem.objects.bulk_create([MenuItem(menu=menu, site=site, label="new", item_type="custom", target="/", sort_order=1)]),
        lambda: MenuItem.objects.filter(pk=item.pk).delete(),
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            operation()
    with pytest.raises(ValidationError):
        item.delete()
    assert Menu.objects.filter(pk=menu.pk).exists()
    assert MenuItem.objects.filter(pk=item.pk).exists()
    # Global shutdown has the same effect as the per-Site switch.
    site.site_modules.filter(module__code="MENUS").update(is_enabled=True)
    Module.objects.filter(code="MENUS").update(is_enabled=False)
    with pytest.raises(IntegrityError), transaction.atomic():
        MenuItem.objects.filter(pk=item.pk).update(label="Changed")


def test_post_owner_cannot_invalidate_existing_menu_link(ready):
    site, other = ready
    menu = Menu.objects.create(site=site, name="Header", location="header")
    post = Post.objects.create(site=site, title="Post", slug="post", content="text")
    _item(menu, "post", item_type="post", post=post)
    with pytest.raises(IntegrityError), transaction.atomic():
        Post.objects.filter(pk=post.pk).update(site=other)


def test_authorized_services_deny_foreign_site_and_unsafe_cross_site_opt_in(ready, editor):
    site, other = ready
    menu = create_menu(actor=editor, site_id=site.pk, name="Header", location="header")
    with pytest.raises(PermissionDenied):
        create_menu(actor=None, site_id=site.pk, name="Footer", location="footer")
    stranger = get_user_model().objects.create_user(username="unassigned", is_staff=True, is_superuser=True)
    with pytest.raises(PermissionDenied):
        update_menu(menu.pk, actor=stranger, name="changed")
    with pytest.raises(PermissionDenied):
        create_menu(actor=editor, site_id=other.pk, name="Header", location="header")
    foreign_page = create_page(site=other, title="Foreign", slug="foreign")
    with pytest.raises(PermissionDenied):
        create_menu_item(menu.pk, actor=editor, label="leak", item_type="page", page=foreign_page, allow_cross_site=True)
    UserRoleAssignment.objects.create(
        user=editor, role=Role.objects.get(code="viewer"), scope="SITE", site=other,
        organization=other.organization_unit,
    )
    linked = create_menu_item(menu.pk, actor=editor, expected=menu_etag(menu), label="shared", item_type="page", page=foreign_page, allow_cross_site=True)
    assert linked.page_id == foreign_page.pk
    with pytest.raises(ValidationError):
        update_menu(menu.pk, actor=editor, site_id=other.pk)
    with pytest.raises(PermissionDenied):
        menu_tree(menu.pk, actor=stranger)
    site.site_modules.filter(module__code="MENUS").update(is_enabled=False)
    with pytest.raises(ValidationError, match="MENUS"):
        update_menu_item(linked.pk, actor=editor, label="changed")


def test_tree_order_inactive_branches_and_size_limit(ready, editor):
    menu = create_menu(actor=editor, site_id=ready[0].pk, name="Header", location="header")
    last = _item(menu, "last", sort_order=2)
    first = _item(menu, "first", sort_order=0)
    hidden = _item(menu, "hidden", sort_order=1, is_active=False)
    child = _item(menu, "child", parent=first)
    _item(menu, "hidden-child", parent=hidden)
    with CaptureQueriesContext(connection) as queries:
        tree = menu_tree(menu.pk, actor=editor)
    assert sum('FROM "cms_menuitem"' in query["sql"] for query in queries) == 1
    assert [node["item"].pk for node in tree] == [first.pk, last.pk]
    assert tree[0]["children"][0]["item"].pk == child.pk
    assert len(menu_tree(menu.pk, actor=editor, include_inactive=True)) == 3
    with pytest.raises(ValidationError, match="limit"):
        menu_tree(menu.pk, actor=editor, limit=2)
    menu.refresh_from_db()  # Child writes invalidate the aggregate version.
    menu.is_active = False
    menu.save()
    assert menu_tree(menu.pk, actor=editor) == []


def test_inactive_actor_and_revoked_assignments_do_not_grant_access(ready, editor):
    from django.utils import timezone
    menu = create_menu(actor=editor, site_id=ready[0].pk, name="Header", location="header")
    editor.is_active = False
    editor.save(update_fields=["is_active"])
    with pytest.raises(PermissionDenied):
        update_menu(menu.pk, actor=editor, name="Changed")
    editor.is_active = True
    editor.save(update_fields=["is_active"])
    UserRoleAssignment.objects.filter(user=editor).update(revoked_at=timezone.now())
    with pytest.raises(PermissionDenied):
        menu_tree(menu.pk, actor=editor)


def test_unconfigured_locations_are_rejected(ready):
    with pytest.raises(ValidationError, match="location"):
        Menu.objects.create(site=ready[0], location="unregistered", name="Unknown")


def test_missing_internal_target_returns_validation_error(ready):
    menu = Menu.objects.create(site=ready[0], location="header", name="Header")
    with pytest.raises(ValidationError):
        MenuItem.objects.create(menu=menu, site=ready[0], label="missing", item_type="page", page_id=uuid.uuid4())


def test_menu_enablement_api_preserves_records_and_rejects_unauthorized_users(ready, cms_platform_admin, oidc, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = ready[0]
    menu = Menu.objects.create(site=site, name="Header", location="header")
    item = _item(menu, "item")
    enablement = site.site_modules.get(module__code="MENUS")
    url = f"/api/v1/sites/{site.pk}/modules/{enablement.pk}/"
    detail = cms_platform_admin.get(url)
    assert detail.status_code == 200
    response = cms_platform_admin.post(url + "disable/", {}, content_type="application/json", HTTP_IF_MATCH=detail["ETag"])
    assert response.status_code == 200
    with pytest.raises(ValidationError):
        item.save()
    # The management endpoint must allow the module to be switched back on.
    response = cms_platform_admin.post(url + "enable/", {}, content_type="application/json", HTTP_IF_MATCH=response["ETag"])
    assert response.status_code == 200
    assert MenuItem.objects.filter(pk=item.pk).exists()
    unauthorized = oidc.header(sub=str(uuid.uuid4()), preferred_username="menu-unassigned", realm_access={"roles": ["platform-admin"]})
    assert cms_platform_admin.get(url, **unauthorized).status_code == 403
    assert cms_platform_admin.get(url, HTTP_AUTHORIZATION="").status_code == 401


@pytest.mark.django_db(transaction=True)
def test_simultaneous_inverse_moves_cannot_commit_a_cycle(ready):
    menu = Menu.objects.create(site=ready[0], name="Header", location="header")
    left = _item(menu, "left", sort_order=0)
    right = _item(menu, "right", sort_order=1)
    barrier = Barrier(2)

    def move(node, parent):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                with transaction.atomic():
                    with connection.cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout='10s'")
                        cursor.execute("UPDATE cms_menuitem SET parent_id=%s WHERE id=%s", [parent, node])
                return "committed"
            except IntegrityError:
                return "rejected"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(move, left.pk, right.pk), pool.submit(move, right.pk, left.pk)]
        assert sorted(future.result(timeout=20) for future in futures) == ["committed", "rejected"]


@pytest.mark.django_db(transaction=True)
def test_menu_migrations_reverse_and_reapply():
    Module.objects.get_or_create(code="MENUS", defaults={"name": "Menus", "status": "IMPLEMENTED", "description": "Site menu trees."})
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("cms", "0007_sitepublicationversion_pages_module")])
        assert "cms_menu" not in connection.introspection.table_names()
    finally:
        MigrationExecutor(connection).migrate(latest)
    assert "cms_menuitem" in connection.introspection.table_names()
    assert Module.objects.get(code="MENUS").is_enabled is False


@pytest.mark.django_db(transaction=True)
def test_integrity_migration_preserves_disabled_data_and_rejects_legacy_cycles(sites):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    old = [("cms", "0008_menu_menuitem")]
    old_items = None
    try:
        executor.migrate(old)
        state = executor.loader.project_state(old).apps
        old_menu = state.get_model("cms", "Menu").objects.create(site_id=sites[0].pk, name="Legacy", location="header")
        old_items = state.get_model("cms", "MenuItem").objects
        root = old_items.create(menu_id=old_menu.pk, site_id=sites[0].pk, label="Root", item_type="custom", target="/", sort_order=0)
        child = old_items.create(menu_id=old_menu.pk, site_id=sites[0].pk, label="Child", item_type="custom", target="/", parent_id=root.pk, sort_order=1)
        old_items.filter(pk=root.pk).update(parent_id=child.pk)
        with pytest.raises(IntegrityError, match="cycle"):
            MigrationExecutor(connection).migrate(latest)
        old_items.filter(pk=root.pk).update(parent_id=None)
        MigrationExecutor(connection).migrate(latest)
        assert MenuItem.objects.filter(menu_id=old_menu.pk).count() == 2
    finally:
        # Also restores the schema if an assertion fails before the upgrade.
        with connection.cursor() as cursor:
            columns = {col.name for col in connection.introspection.get_table_description(cursor, "cms_menu")}
        if old_items is not None and "is_active" not in columns:
            old_items.update(parent_id=None)
        MigrationExecutor(connection).migrate(latest)
