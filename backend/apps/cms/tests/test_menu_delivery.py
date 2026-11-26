"""Effective public menus: precedence, inheritance, cache scope and module gate."""
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.api.models import Post
from apps.audit.models import AuditEvent
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.menu_cache import delivery_version
from apps.cms.menu_assignment_models import MenuLocationAssignment
from apps.cms.menu_models import Menu, MenuInheritance, MenuItem
from apps.cms.tests.support import transition_with_site_role
from apps.cms.selectors.menu_delivery import compose_location
from apps.cms.services.pages import create_page
from apps.cms.services.publication_cache import get_public_cache
from apps.cms.models import ContentStatus, PublishedContentSnapshot
from apps.cms.tests.test_menus import ready  # noqa: F401
from apps.sites.models import Module, Site, SiteDomain, SiteModule
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site

pytestmark = pytest.mark.django_db

PUBLIC = "/api/v1/site-context/menus/"


@pytest.fixture
def family(ready, settings):
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "KEY_PREFIX": "uog",
            "KEY_FUNCTION": "apps.core.cache.make_cache_key",
        }
    }
    child, sibling = ready
    main = Site.objects.create(
        organization_unit=child.organization_unit.parent,
        code="MAIN", name="University", is_main=True,
    )
    parent = Site.objects.create(
        organization_unit=child.organization_unit, code="PARENT", name="Parent college",
    )
    module = Module.objects.get(code="MENUS")
    for site in (main, parent):
        enable_module_for_site(site.pk, module.pk)
    for site in (main, parent, child, sibling):
        for code in ("PAGES","POSTS"):
            enable_module_for_site(site.pk, Module.objects.get(code=code).pk)
        activate_site(site.pk)
        SiteDomain.objects.create(
            site=site, hostname=f"site-{site.pk}.uog.edu.et",
            is_primary=True, status=SiteDomain.Status.ACTIVE,
        )
    return main, parent, child, sibling


def _host(site):
    return f"site-{site.pk}.uog.edu.et"


def _link(menu, label, **overrides):
    values = {
        "menu": menu, "site": menu.site, "label": label, "item_type": "custom",
        "target": "/" + label.lower().replace(" ", "-"), "sort_order": 0,
    }
    values.update(overrides)
    if values["item_type"] in {"page", "post", "category", "news"}:
        values["target"] = ""
    return MenuItem.objects.create(**values)


def _publish_post(post):
    for action in ("submit", "approve", "publish"):
        actor = get_user_model().objects.create_user(
            username=f"{action}-{post.slug}-{uuid4().hex[:8]}",
        )
        transition_with_site_role(post, action, actor)
    return post


def _roots(site_id, location="header"):
    return [(row["label"], row["source"]) for row in compose_location(site_id, location)]


def test_precedence_matrix_orders_global_parent_and_local_items(family):
    main, parent, child, _sibling = family
    global_menu = Menu.objects.create(site=main, location="header", name="Global", is_global=True)
    _link(global_menu, "University")
    parent_menu = Menu.objects.create(site=parent, location="header", name="Parent")
    _link(parent_menu, "Colleges")
    local_menu = Menu.objects.create(site=child, location="header", name="Local")
    _link(local_menu, "Department")
    cases = (
        ({"include_global": False, "inherit_from": None, "local_precedence": "override"}, [("Department", "local")]),
        ({"include_global": True, "inherit_from": None, "local_precedence": "override"}, [("University", "global"), ("Department", "local")]),
        ({"include_global": True, "inherit_from": parent, "local_precedence": "append"}, [("University", "global"), ("Colleges", "inherited"), ("Department", "local")]),
        ({"include_global": True, "inherit_from": parent, "local_precedence": "override"}, [("University", "global"), ("Department", "local")]),
        ({"include_global": False, "inherit_from": parent, "local_precedence": "append"}, [("Colleges", "inherited"), ("Department", "local")]),
    )
    for policy, expected in cases:
        MenuInheritance.objects.update_or_create(site=child, location="header", defaults=policy)
        assert _roots(child.pk) == expected
    local_menu.is_active = False
    local_menu.save(update_fields=["is_active"])
    MenuInheritance.objects.filter(site=child, location="header").update(
        include_global=True, inherit_from_id=parent.pk, local_precedence="override",
    )
    # An inactive local menu does not override, so the parent segment remains.
    assert _roots(child.pk) == [("University", "global"), ("Colleges", "inherited")]


def test_public_header_and_footer_follow_the_resolved_site(family, client):
    main, parent, child, sibling = family
    global_menu = Menu.objects.create(site=main, location="header", name="Global", is_global=True)
    _link(global_menu, "University")
    parent_menu = Menu.objects.create(site=parent, location="header", name="Parent")
    _link(parent_menu, "Colleges")
    child_header = Menu.objects.create(site=child, location="header", name="Local")
    _link(child_header, "Department")
    child_footer = Menu.objects.create(site=child, location="footer", name="Footer")
    _link(child_footer, "Contacts")
    sibling_header = Menu.objects.create(site=sibling, location="header", name="Sibling")
    _link(sibling_header, "Hospital")
    MenuInheritance.objects.create(
        site=child, location="header", inherit_from=parent, include_global=True, local_precedence="append",
    )
    response = client.get(PUBLIC, HTTP_HOST=_host(child))
    assert response.status_code == 200, response.content
    assert "Host" in response["Vary"]
    assert response["Cache-Control"] == "public, max-age=0, must-revalidate"
    body = response.json()
    assert body["site"] == child.pk
    assert [(row["label"], row["source"]) for row in body["locations"]["header"]] == [
        ("University", "global"), ("Colleges", "inherited"), ("Department", "local"),
    ]
    assert [(row["label"], row["source"]) for row in body["locations"]["footer"]] == [("Contacts", "local")]
    assert "Hospital" not in response.content.decode()
    sibling_response = client.get(PUBLIC + "?location=header", HTTP_HOST=_host(sibling))
    assert [row["label"] for row in sibling_response.json()["locations"]["header"]] == ["Hospital"]
    assert "locations" in sibling_response.json() and "footer" not in sibling_response.json()["locations"]
    spoofed = client.get(PUBLIC, HTTP_HOST=_host(child), HTTP_X_FORWARDED_HOST=_host(sibling))
    assert spoofed.json()["site"] == child.pk
    assert client.get(PUBLIC + "?site=" + str(sibling.pk), HTTP_HOST=_host(child)).status_code == 400
    assert client.get(PUBLIC, HTTP_HOST="testserver").status_code == 404


def test_unpublished_targets_and_inactive_branches_are_omitted(family):
    _main, _parent, child, _sibling = family
    menu = Menu.objects.create(site=child, location="header", name="Local")
    hidden = _link(menu, "Secret", is_active=False, sort_order=0)
    _link(menu, "Still secret", parent=hidden, sort_order=0)
    draft = create_page(site=child, title="Draft", slug="draft")
    _link(menu, "Draft page", item_type="page", page=draft, sort_order=1)
    _link(menu, "Outside", item_type="external", target="https://example.com/outside", sort_order=2)
    Post.objects.create(site=child, title="Hidden", slug="hidden", content="Hidden")
    visible = Post.objects.create(site=child, title="Visible", slug="visible", content="Visible")
    _publish_post(visible)
    hidden_post = Post.objects.get(site=child, slug="hidden")
    _link(menu, "Hidden news", item_type="post", post=hidden_post, sort_order=3)
    _link(menu, "Visible news", item_type="post", post=visible, sort_order=4)
    assert _roots(child.pk) == [("Outside", "local"), ("Visible news", "local")]
    assert compose_location(child.pk, "header")[1]["href"] == "/posts/visible"


def test_public_menu_cache_hit_skips_recompose(family, client):
    """Finding 2: versioned cache must be returned without recomposing."""
    _main, _parent, child, _sibling = family
    menu = Menu.objects.create(site=child, location="header", name="Local")
    _link(menu, "Department")
    host = _host(child)
    first = client.get(PUBLIC + "?location=header", HTTP_HOST=host)
    assert first.status_code == 200
    assert [row["label"] for row in first.json()["locations"]["header"]] == ["Department"]
    with patch(
        "apps.cms.api.menu_delivery.compose_location", wraps=compose_location,
    ) as recomposed:
        second = client.get(PUBLIC + "?location=header", HTTP_HOST=host)
        assert second.status_code == 200
        assert second.json()["locations"]["header"] == first.json()["locations"]["header"]
        recomposed.assert_not_called()


def test_compose_location_destination_queries_stay_bounded(family):
    """Finding 3: destination resolution must not query once per menu item."""
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    _main, _parent, child, _sibling = family
    menu = Menu.objects.create(site=child, location="header", name="Local")
    for index in range(12):
        post = _publish_post(Post.objects.create(
            site=child, title=f"Story {index}", slug=f"story-{index}", content="Body",
        ))
        _link(menu, f"Story {index}", item_type="post", post=post, sort_order=index)
    _link(menu, "News index", item_type="news", target="", sort_order=12)
    _link(menu, "Campus", sort_order=13)
    with CaptureQueriesContext(connection) as captured:
        tree = compose_location(child.pk, "header")
    # Batched destinations keep this under one query per linked target.
    assert len(captured) <= 18, f"{len(captured)} queries: {[q['sql'] for q in captured]}"
    assert len(tree) == 14
    assert tree[0]["href"].startswith("/posts/")
    assert tree[12]["href"] == "/posts"


def test_post_publish_and_unpublish_invalidate_linked_menu_delivery(family):
    _main, _parent, child, _sibling = family
    menu = Menu.objects.create(site=child, location="header", name="Local")
    post = Post.objects.create(
        site=child, title="Campus update", slug="campus-update", content="News",
    )
    _link(menu, "Campus update", item_type="post", post=post)
    before = delivery_version(child.pk, "header")
    assert _roots(child.pk) == []

    _publish_post(post)
    published_version = delivery_version(child.pk, "header")
    assert published_version > before
    assert _roots(child.pk) == [("Campus update", "local")]
    snapshot = PublishedContentSnapshot.objects.get(content_id=post.pk, version=1)
    assert snapshot.payload["title"] == "Campus update"

    publisher = get_user_model().objects.create_user(username="post-menu-unpublisher")
    transition_with_site_role(post, "unpublish", publisher)
    assert delivery_version(child.pk, "header") > published_version
    assert _roots(child.pk) == []
    assert Post.objects.get(pk=post.pk).status == ContentStatus.UNPUBLISHED


def test_page_category_and_global_post_invalidate_linked_menu_delivery(family, client):
    """Finding 7: Page, Category and global-post targets must bump delivery versions."""
    from apps.api.models import Category

    main, _parent, child, sibling = family
    MenuInheritance.objects.create(
        site=child, location="header", include_global=True,
        inherit_from=None, local_precedence="append",
    )
    global_menu = Menu.objects.create(
        site=main, location="header", name="Global", is_global=True,
    )
    global_post = Post.objects.create(
        site=main, title="University news", slug="university-news", content="Body",
    )
    _link(global_menu, "University news", item_type="post", post=global_post)

    local = Menu.objects.create(site=child, location="header", name="Local")
    page = create_page(site=child, title="About", slug="about")
    _link(local, "About", item_type="page", page=page, sort_order=0)
    category = Category.objects.create(site=child, code="RESEARCH", name="Research")
    _link(local, "Research", item_type="category", category=category, sort_order=1)

    before_child = delivery_version(child.pk, "header")
    before_sibling = delivery_version(sibling.pk, "header")
    assert client.get(PUBLIC + "?location=header", HTTP_HOST=_host(child)).status_code == 200

    _publish_post(global_post)
    after_global = delivery_version(child.pk, "header")
    assert after_global > before_child
    assert delivery_version(sibling.pk, "header") == before_sibling
    assert ("University news", "global") in _roots(child.pk)

    page_before = after_global
    for action in ("submit", "approve", "publish"):
        transition_with_site_role(
            page, action,
            get_user_model().objects.create_user(username=f"page-{action}-{uuid4().hex[:6]}"),
        )
    assert delivery_version(child.pk, "header") > page_before
    assert ("About", "local") in _roots(child.pk)

    category_before = delivery_version(child.pk, "header")
    for action in ("submit", "approve", "publish"):
        transition_with_site_role(
            category, action,
            get_user_model().objects.create_user(username=f"cat-{action}-{uuid4().hex[:6]}"),
        )
    assert delivery_version(child.pk, "header") > category_before
    assert ("Research", "local") in _roots(child.pk)


def test_inheritance_rejects_loops_and_does_not_grant_parent_management(family, client, oidc, settings):
    settings.DEBUG = False
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = False
    main, parent, child, _sibling = family
    call_command("seed_rbac", verbosity=0)
    user = get_user_model().objects.create_user(username="child-menu-admin", email="child-menu-admin@uog.et")
    UserRoleAssignment.objects.create(
        user=user, role=Role.objects.get(code="site-administrator"), scope="SITE",
        site=child, organization=child.organization_unit,
    )
    header = oidc.header(
        sub=str(uuid4()), preferred_username=user.username, email=user.email,
        realm_access={"roles": ["platform-admin"]},
    )
    assert client.get("/api/me/", **header).status_code == 200
    parent_menu = Menu.objects.create(site=parent, location="header", name="Parent")
    policy = {
        "inherit_from": parent.pk, "include_global": False, "local_precedence": "append",
    }
    url = f"/api/v1/sites/{child.pk}/menu-inheritance/header/"
    saved = client.put(url, policy, content_type="application/json", **header)
    assert saved.status_code == 200, saved.content
    event = AuditEvent.objects.get(action="MENU_INHERITANCE_UPDATED", entity_id=saved.json()["id"])
    assert event.after["site_id"] == child.pk
    assert client.get(f"/api/v1/sites/{parent.pk}/menus/", **header).status_code == 403
    assert client.patch(
        f"/api/v1/sites/{parent.pk}/menus/{parent_menu.pk}/",
        {"name": "Hijack"}, content_type="application/json", HTTP_IF_MATCH='"menu-stale"', **header,
    ).status_code == 403
    loop = client.put(f"/api/v1/sites/{parent.pk}/menu-inheritance/header/", {
        "inherit_from": child.pk, "include_global": False, "local_precedence": "append",
    }, content_type="application/json", **header)
    assert loop.status_code == 403
    UserRoleAssignment.objects.create(
        user=user, role=Role.objects.get(code="site-administrator"), scope="SITE",
        site=parent, organization=parent.organization_unit,
    )
    loop = client.put(f"/api/v1/sites/{parent.pk}/menu-inheritance/header/", {
        "inherit_from": child.pk, "include_global": False, "local_precedence": "append",
    }, content_type="application/json", **header)
    assert loop.status_code == 400
    assert loop.json()["error"]["details"]["reason"] == "inheritance_loop"
    own = client.put(url, {**policy, "inherit_from": child.pk}, content_type="application/json", **header)
    assert own.status_code == 400
    assert own.json()["error"]["details"]["reason"] == "inheritance_loop"
    rejected = client.post(
        f"/api/v1/sites/{child.pk}/menus/",
        {"name": "Global", "location": "footer", "is_global": True},
        content_type="application/json", **header,
    )
    assert rejected.status_code == 403
    with pytest.raises(ValidationError):
        Menu.objects.create(site=child, location="sidebar", name="Not central", is_global=True)


def test_disabled_module_hides_public_menus_without_deleting_rows(family, client):
    main, parent, child, sibling = family
    global_menu = Menu.objects.create(site=main, location="header", name="Global", is_global=True)
    _link(global_menu, "University")
    parent_menu = Menu.objects.create(site=parent, location="header", name="Parent")
    _link(parent_menu, "Colleges")
    local_menu = Menu.objects.create(site=child, location="header", name="Local")
    _link(local_menu, "Department")
    MenuInheritance.objects.create(
        site=child, location="header", inherit_from=parent, include_global=True, local_precedence="append",
    )
    SiteModule.objects.filter(site=parent, module__code="MENUS").update(is_enabled=False)
    assert _roots(child.pk) == [("University", "global"), ("Department", "local")]
    SiteModule.objects.filter(site=child, module__code="MENUS").update(is_enabled=False)
    hidden = client.get(PUBLIC, HTTP_HOST=_host(child))
    assert hidden.status_code == 404
    assert Menu.objects.filter(pk=local_menu.pk).exists()
    assert MenuItem.objects.filter(menu=local_menu).exists()
    sibling_menu = Menu.objects.create(site=sibling, location="header", name="Sibling")
    _link(sibling_menu, "Hospital")
    visible = client.get(PUBLIC + "?location=header", HTTP_HOST=_host(sibling))
    assert visible.status_code == 200
    assert [row["label"] for row in visible.json()["locations"]["header"]] == ["Hospital"]


def test_menu_changes_invalidate_only_affected_site_and_location_caches(family, client):
    main, parent, child, sibling = family
    global_menu = Menu.objects.create(site=main, location="header", name="Global", is_global=True)
    university = _link(global_menu, "University")
    parent_menu = Menu.objects.create(site=parent, location="header", name="Parent")
    colleges = _link(parent_menu, "Colleges")
    child_header = Menu.objects.create(site=child, location="header", name="Local")
    _link(child_header, "Department")
    child_footer = Menu.objects.create(site=child, location="footer", name="Footer")
    _link(child_footer, "Contacts")
    sibling_header = Menu.objects.create(site=sibling, location="header", name="Sibling")
    hospital = _link(sibling_header, "Hospital")
    MenuInheritance.objects.create(
        site=child, location="header", inherit_from=parent, include_global=True, local_precedence="append",
    )
    assert client.get(PUBLIC, HTTP_HOST=_host(child)).status_code == 200
    assert client.get(PUBLIC, HTTP_HOST=_host(sibling)).status_code == 200
    child_header_version = delivery_version(child.pk, "header")
    child_footer_version = delivery_version(child.pk, "footer")
    sibling_header_version = delivery_version(sibling.pk, "header")
    child_key = f"menu:header:delivery:{child_header_version}"
    assert get_public_cache(child.pk, child_key) is not None
    assert get_public_cache(sibling.pk, child_key) is None
    hospital.label = "Clinic"
    hospital.save()
    assert delivery_version(child.pk, "header") == child_header_version
    assert delivery_version(child.pk, "footer") == child_footer_version
    assert delivery_version(sibling.pk, "header") == sibling_header_version + 1
    assert get_public_cache(child.pk, child_key)[0]["label"] == "University"
    colleges.label = "Schools"
    colleges.save()
    assert delivery_version(child.pk, "header") == child_header_version + 1
    assert delivery_version(sibling.pk, "header") == sibling_header_version + 1
    assert delivery_version(child.pk, "footer") == child_footer_version
    refreshed = client.get(PUBLIC + "?location=header", HTTP_HOST=_host(child))
    assert [row["label"] for row in refreshed.json()["locations"]["header"]] == ["University", "Schools", "Department"]
    before_global = delivery_version(child.pk, "header")
    sibling_before = delivery_version(sibling.pk, "header")
    university.label = "UoG"
    university.save()
    assert delivery_version(child.pk, "header") == before_global + 1
    assert delivery_version(sibling.pk, "header") == sibling_before
    assert [row["label"] for row in client.get(PUBLIC + "?location=header", HTTP_HOST=_host(child)).json()["locations"]["header"]] == [
        "UoG", "Schools", "Department",
    ]


def _publish_assignment(site, location, menu):
    """Persist a published location assignment without going through the HTTP API."""
    actor = get_user_model().objects.create_user(
        username=f"assign-{site.pk}-{uuid4().hex[:8]}",
    )
    row = MenuLocationAssignment.objects.filter(site=site, location=location).first()
    if row is None:
        row = MenuLocationAssignment(site=site, location=location)
    row.draft_menu = menu
    row.published_menu = menu
    row.draft_menus = []
    row.published_menus = []
    row.is_published = True
    row.updated_by = actor
    row.save()
    return row


def test_published_assignment_keeps_include_global_and_append_inheritance(family):
    """Finding 1: a published assignment is the local segment, not a hard override of policy."""
    main, parent, child, _sibling = family
    global_menu = Menu.objects.create(site=main, location="header", name="Global", is_global=True)
    _link(global_menu, "University")
    parent_menu = Menu.objects.create(site=parent, location="header", name="Parent")
    _link(parent_menu, "Colleges")
    local_menu = Menu.objects.create(site=child, location="", name="Assigned local", code="assigned-local")
    _link(local_menu, "Department")
    _publish_assignment(child, "header", local_menu)
    MenuInheritance.objects.create(
        site=child, location="header", inherit_from=parent,
        include_global=True, local_precedence="append",
    )
    assert _roots(child.pk) == [
        ("University", "global"), ("Colleges", "inherited"), ("Department", "local"),
    ]


def test_child_inherits_parent_assigned_local_menu_not_composed_tree(family):
    """Finding 1: inheritance copies the parent's assigned local menu only."""
    main, parent, child, _sibling = family
    global_menu = Menu.objects.create(site=main, location="header", name="Global", is_global=True)
    _link(global_menu, "University")
    parent_assigned = Menu.objects.create(
        site=parent, location="", name="Parent assigned", code="parent-assigned",
    )
    _link(parent_assigned, "Assigned parent")
    _publish_assignment(parent, "header", parent_assigned)
    MenuInheritance.objects.create(
        site=parent, location="header", include_global=True, local_precedence="override",
    )
    MenuInheritance.objects.create(
        site=child, location="header", inherit_from=parent,
        include_global=False, local_precedence="append",
    )
    # Parent composition includes global + assigned local.
    assert _roots(parent.pk) == [("University", "global"), ("Assigned parent", "local")]
    # Child inherits only the parent's local assignment, not the parent's global fragment.
    assert _roots(child.pk) == [("Assigned parent", "inherited")]
