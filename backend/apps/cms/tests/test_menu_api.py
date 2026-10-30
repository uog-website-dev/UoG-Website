"""Menu API scope, optimistic concurrency, atomic trees and durable auditing."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4
import io

import pytest
import yaml
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection, connections, close_old_connections, transaction, IntegrityError
from django.test import Client

from apps.audit.models import AuditEvent
from apps.authorization.models import Permission, Role, UserRoleAssignment
from apps.cms.menu_models import Menu, MenuItem
from apps.cms.services.pages import create_page
from apps.api.models import Post
from apps.cms.tests.test_menus import ready  # noqa: F401
from apps.sites.models import Module

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(ready, oidc, client):
    call_command("seed_rbac", verbosity=0)
    site, other = ready
    user = get_user_model().objects.create_user(username="menu-admin", email="menu-admin@uog.et")
    UserRoleAssignment.objects.create(user=user, role=Role.objects.get(code="site-administrator"), scope="SITE", site=site, organization=site.organization_unit)
    header = oidc.header(sub=str(uuid4()), preferred_username=user.username, email=user.email, realm_access={"roles": ["platform-viewer"]})
    assert client.get("/api/me/", **header).status_code == 200
    return SimpleNamespace(site=site, other=other, user=user, header=header, client=client, base=f"/api/v1/sites/{site.pk}/menus/", oidc=oidc)


def _menu(api, location="header"):
    response = api.client.post(api.base, {"name": "Navigation", "location": location}, content_type="application/json", **api.header)
    assert response.status_code == 201, response.content
    return response["Location"]


def _tag(api, url):
    response = api.client.get(url, **api.header)
    assert response.status_code == 200, response.content
    return response["ETag"]


def _item(api, url, label, **fields):
    response = api.client.post(url + "items/", {"label": label, "item_type": "custom", "target": "/about", **fields}, content_type="application/json", HTTP_IF_MATCH=_tag(api, url), **api.header)
    assert response.status_code == 201, response.content
    return response["Location"]


def _post(api, url, data, token):
    return api.client.post(url, data, content_type="application/json", HTTP_IF_MATCH=token, **api.header)


def test_menu_crud_duplicate_location_version_conflicts_and_request_id(api, settings):
    settings.DEBUG = False  # Scoped RBAC, not a development/public-write bypass.
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = False
    request_id = str(uuid4())
    response = api.client.post(api.base, {"name": "Header", "location": "header"}, content_type="application/json", HTTP_X_REQUEST_ID=request_id, **api.header)
    assert response.status_code == 201, response.content
    url = response["Location"]
    assert response.json()["is_active"] is False
    assert response.json()["version"] >= 1
    assert response["X-Request-ID"] == request_id
    assert response["Cache-Control"] == "private, no-store"
    duplicate = api.client.post(api.base, {"name": "Duplicate", "location": "header"}, content_type="application/json", **api.header)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["details"]["reason"] == "duplicate_location"
    missing = api.client.patch(url, {"name": "Changed"}, content_type="application/json", **api.header)
    assert missing.status_code == 428
    old = response["ETag"]
    changed = api.client.patch(url, {"name": "Changed"}, content_type="application/json", HTTP_IF_MATCH=old, **api.header)
    assert changed.status_code == 200, changed.content
    assert changed["ETag"] != old
    stale = api.client.patch(url, {"name": "Lost update"}, content_type="application/json", HTTP_IF_MATCH=old, **api.header)
    assert stale.status_code == 409
    assert stale.json()["error"]["details"]["reason"] == "version_conflict"
    rows = api.client.get(api.base + "?is_active=false&page_size=1", **api.header)
    assert rows.status_code == 200 and rows.json()["count"] == 1
    assert api.client.put(url, {}, content_type="application/json", **api.header).status_code == 405
    for bad in ({"site": api.other.pk}, {"version": 0}, {"is_active": True}):
        rejected = api.client.patch(url, bad, content_type="application/json", HTTP_IF_MATCH=changed["ETag"], **api.header)
        assert rejected.status_code == 400
    deleted = api.client.delete(url, HTTP_IF_MATCH=changed["ETag"], **api.header)
    assert deleted.status_code == 204
    assert api.client.get(url, **api.header).status_code == 404


def test_item_crud_move_tree_activation_and_safe_delete_policy(api):
    url = _menu(api)
    first = _item(api, url, "First")
    second = _item(api, url, "Second")
    first_id = api.client.get(first, **api.header).json()["id"]
    second_id = api.client.get(second, **api.header).json()["id"]
    child = _item(api, url, "Child", parent=first_id)
    tree = api.client.get(url + "tree/", **api.header)
    assert [row["label"] for row in tree.json()["items"]] == ["First", "Child", "Second"]
    moved = _post(api, child + "move/", {"parent": second_id, "position": 0}, tree["ETag"])
    assert moved.status_code == 200, moved.content
    assert moved.json()["parent"] == second_id
    patched = api.client.patch(child, {"label": "Renamed"}, content_type="application/json", HTTP_IF_MATCH=moved["ETag"], **api.header)
    assert patched.status_code == 200
    assert api.client.get(url + "tree/?include_inactive=false", **api.header).json()["items"] == []
    activated = _post(api, url + "activate/", {}, patched["ETag"])
    assert activated.status_code == 200 and activated.json()["is_active"] is True
    visible = api.client.get(url + "tree/?include_inactive=false", **api.header)
    assert [row["label"] for row in visible.json()["items"]] == ["First", "Second", "Renamed"]
    deactivated = _post(api, url + "deactivate/", {}, visible["ETag"])
    assert deactivated.status_code == 200 and deactivated.json()["is_active"] is False
    blocked = api.client.delete(url, HTTP_IF_MATCH=deactivated["ETag"], **api.header)
    assert blocked.status_code == 409 and blocked.json()["error"]["details"]["reason"] == "children_present"
    blocked = api.client.delete(second, HTTP_IF_MATCH=deactivated["ETag"], **api.header)
    assert blocked.status_code == 409
    for item_url in (child, first, second):
        response = api.client.delete(item_url, HTTP_IF_MATCH=_tag(api, url), **api.header)
        assert response.status_code == 204, response.content
        assert "ETag" in response
    assert api.client.delete(url, HTTP_IF_MATCH=_tag(api, url), **api.header).status_code == 204


def test_atomic_reorder_and_invalid_payloads_do_not_partially_mutate(api):
    url = _menu(api)
    item_urls = [_item(api, url, label) for label in ("A", "B", "C")]
    ids = [api.client.get(item_url, **api.header).json()["id"] for item_url in item_urls]
    result = _post(api, url + "reorder/", {"parent": None, "items": list(reversed(ids))}, _tag(api, url))
    assert result.status_code == 200, result.content
    assert [row["id"] for row in result.json()["items"]] == list(reversed(ids))
    current = result["ETag"]
    before = list(MenuItem.objects.order_by("id").values_list("id", "parent_id", "sort_order"))
    audit_count = AuditEvent.objects.count()
    for bad in (ids[:2], [ids[0]] * 3, [*ids[:2], str(uuid4())]):
        response = _post(api, url + "reorder/", {"parent": None, "items": bad}, current)
        assert response.status_code == 400, response.content
        assert response.json()["error"]["details"]["reason"] == "invalid_order"
        assert _tag(api, url) == current
    assert list(MenuItem.objects.order_by("id").values_list("id", "parent_id", "sort_order")) == before
    assert AuditEvent.objects.count() == audit_count
    assert AuditEvent.objects.filter(action="MENU_ITEMS_REORDERED").count() == 1


def test_invalid_cycle_and_descendant_depth_roll_back_positions_versions_and_audits(api):
    url = _menu(api)
    root = _item(api, url, "Root")
    cursor = root
    for label in ("Level 2", "Level 3", "Level 4"):
        cursor = _item(api, url, label, parent=api.client.get(cursor, **api.header).json()["id"])
    other = _item(api, url, "Other")
    deep_id = api.client.get(cursor, **api.header).json()["id"]
    other_id = api.client.get(other, **api.header).json()["id"]
    token = _tag(api, url)
    before = list(MenuItem.objects.order_by("id").values_list("id", "parent_id", "sort_order"))
    audit_count = AuditEvent.objects.count()
    for parent in (deep_id, other_id):
        response = _post(api, root + "move/", {"parent": parent, "position": 0}, token)
        assert response.status_code == 400, response.content
        assert response.json()["error"]["details"]["reason"] == "invalid_tree"
    assert _tag(api, url) == token
    assert list(MenuItem.objects.order_by("id").values_list("id", "parent_id", "sort_order")) == before
    assert AuditEvent.objects.count() == audit_count


@pytest.mark.parametrize("target", ["javascript:alert(1)", "data:text/html,bad", "//evil.example", "https://example.com/%0d%0aLocation:evil"])
def test_unsafe_targets_return_typed_errors_without_writes(api, target):
    url = _menu(api)
    token = _tag(api, url)
    response = _post(api, url + "items/", {"label": "Bad", "item_type": "external", "target": target}, token)
    assert response.status_code == 400, response.content
    assert response.json()["error"]["details"]["reason"] == "invalid_target"
    assert _tag(api, url) == token
    assert not MenuItem.objects.exists()


def test_cross_site_scope_foreign_parent_and_forged_claims_are_rejected(api):
    url = _menu(api)
    foreign = Menu.objects.create(site=api.other, location="header", name="Foreign")
    foreign_item = MenuItem.objects.create(menu=foreign, site=api.other, label="Foreign", item_type="custom", target="/")
    assert api.client.get(f"/api/v1/sites/{api.other.pk}/menus/", **api.header).status_code == 403
    assert api.client.patch(api.base + f"{foreign.pk}/", {"name": "Hijack"}, content_type="application/json", HTTP_IF_MATCH=_tag(api, url), **api.header).status_code == 404
    response = _post(api, url + "items/", {"label": "Bad parent", "item_type": "custom", "target": "/", "parent": str(foreign_item.pk)}, _tag(api, url))
    assert response.status_code == 400 and response.json()["error"]["details"]["reason"] == "invalid_tree"
    response = _post(api, url + "items/", {"label": "Missing page", "item_type": "page", "page": str(uuid4())}, _tag(api, url))
    assert response.status_code == 400 and response.json()["error"]["details"]["reason"] == "invalid_target"
    unassigned = api.oidc.header(sub=str(uuid4()), preferred_username="menu-forged-admin", email="menu-forged-admin@uog.et", realm_access={"roles": ["platform-admin"]})
    assert api.client.post(api.base, {"name": "Forged", "location": "footer"}, content_type="application/json", **unassigned).status_code == 403
    assert api.client.post(api.base, {}, content_type="application/json").status_code == 401


def test_permission_codes_and_publication_are_independent(api):
    url = _menu(api)
    user = get_user_model().objects.create_user(username="menu-editor", email="menu-editor@uog.et")
    UserRoleAssignment.objects.create(user=user, role=Role.objects.get(code="editor"), scope="SITE", site=api.site, organization=api.site.organization_unit)
    header = api.oidc.header(sub=str(uuid4()), preferred_username=user.username, email=user.email, realm_access={"roles": ["platform-admin"]})
    draft_edit = api.client.patch(url, {"name": "Edited draft"}, content_type="application/json", HTTP_IF_MATCH=_tag(api, url), **header)
    assert draft_edit.status_code == 200
    assert api.client.post(url + "activate/", {}, content_type="application/json", HTTP_IF_MATCH=draft_edit["ETag"], **header).status_code == 403
    activated = _post(api, url + "activate/", {}, draft_edit["ETag"])
    assert activated.status_code == 200
    assert api.client.patch(url, {"name": "Bypass publishing"}, content_type="application/json", HTTP_IF_MATCH=activated["ETag"], **header).status_code == 403
    UserRoleAssignment.objects.filter(user=user).update(role=Role.objects.get(code="viewer"))
    assert api.client.get(url, **header).status_code == 200
    assert api.client.post(api.base, {"name": "No write grant", "location": "footer"}, content_type="application/json", **header).status_code == 403


def test_disabled_permission_is_denied_even_with_platform_administrator_grant(api):
    url = _menu(api)
    UserRoleAssignment.objects.create(user=api.user, role=Role.objects.get(code="platform-administrator"), scope="PLATFORM")
    Permission.objects.filter(code="menu.read").update(is_active=False)
    assert api.client.get(url, **api.header).status_code == 403


def test_invalid_primitive_targets_and_unsupported_idempotency_have_safe_errors(api):
    url = _menu(api)
    token = _tag(api, url)
    response = _post(api, url + "items/", {"label": "Invalid UUID", "item_type": "page", "page": "not-a-uuid"}, token)
    assert response.status_code == 400
    assert response.json()["error"]["details"]["reason"] == "invalid_target"
    response = api.client.post(api.base, {"name": "Footer", "location": "footer"}, content_type="application/json", HTTP_IDEMPOTENCY_KEY="unsupported", **api.header)
    assert response.status_code == 400
    assert api.client.post(api.base, "name=Footer&location=footer", content_type="application/x-www-form-urlencoded", **api.header).status_code == 415


def test_disabled_module_blocks_api_mutations_but_not_admin_inspection(api):
    url = _menu(api)
    item = _item(api, url, "Kept")
    token = _tag(api, url)
    api.site.site_modules.filter(module__code="MENUS").update(is_enabled=False)
    response = api.client.patch(item, {"label": "Denied"}, content_type="application/json", HTTP_IF_MATCH=token, **api.header)
    assert response.status_code == 400 and response.json()["error"]["details"]["reason"] == "module_disabled"
    assert api.client.get(url + "tree/", **api.header).json()["items"][0]["label"] == "Kept"
    assert _tag(api, url) == token


def test_page_post_targets_and_explicit_cross_site_policy_are_enforced(api):
    url = _menu(api)
    page = create_page(site=api.site, title="About", slug="about")
    post = Post.objects.create(site=api.site, title="News", slug="news", content="News")
    foreign = create_page(site=api.other, title="Other", slug="other")
    for kind, field, pk in (("page", "page", str(page.pk)), ("post", "post", post.pk)):
        response = _post(api, url + "items/", {"label": kind, "item_type": kind, field: pk}, _tag(api, url))
        assert response.status_code == 201, response.content
        assert response.json()[field] == pk
    body = {"label": "Foreign", "item_type": "page", "page": str(foreign.pk), "allow_cross_site": True}
    assert _post(api, url + "items/", body, _tag(api, url)).status_code == 403
    UserRoleAssignment.objects.create(user=api.user, role=Role.objects.get(code="viewer"), scope="SITE", site=api.other, organization=api.other.organization_unit)
    denied = _post(api, url + "items/", {**body, "allow_cross_site": False}, _tag(api, url))
    assert denied.status_code == 400 and denied.json()["error"]["details"]["reason"] == "invalid_target"
    assert _post(api, url + "items/", body, _tag(api, url)).status_code == 201


def test_all_changes_have_shared_site_actor_request_audit_and_urls_are_not_logged(api):
    request_id = str(uuid4())
    response = api.client.post(api.base, {"name": "Audit", "location": "header"}, content_type="application/json", HTTP_X_REQUEST_ID=request_id, **api.header)
    assert response.status_code == 201, response.content
    event = AuditEvent.objects.get(action="MENU_CREATED", entity_id=response.json()["id"])
    assert event.actor_kind == "USER" and event.actor_id == str(api.user.pk)
    assert str(event.request_id) == request_id
    assert event.ip == "127.0.0.1"
    assert event.after["site_id"] == api.site.pk
    url = response["Location"]
    item = _post(api, url + "items/", {"label": "External", "item_type": "external", "target": "https://example.com/?token=do-not-log"}, response["ETag"])
    assert item.status_code == 201, item.content
    changed = api.client.patch(item["Location"], {"target": "https://example.com/?token=also-private"}, content_type="application/json", HTTP_IF_MATCH=item["ETag"], **api.header)
    assert changed.status_code == 200
    events = AuditEvent.objects.filter(entity_type="cms.menu_item")
    assert set(events.values_list("action", flat=True)) == {"MENU_ITEM_CREATED", "MENU_ITEM_UPDATED"}
    for entry in events:
        assert entry.after["site_id"] == api.site.pk and entry.actor_id == str(api.user.pk)
        assert "do-not-log" not in str(entry.after) and "also-private" not in str(entry.after)
    assert events.get(action="MENU_ITEM_UPDATED").after["target_changed"] is True


def test_audit_failure_rolls_back_menu_item_and_aggregate_version(api):
    url = _menu(api)
    item = _item(api, url, "Before")
    token = _tag(api, url)
    with connection.cursor() as cursor:
        cursor.execute("""CREATE FUNCTION test_menu_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.entity_type IN ('cms.menu','cms.menu_item') THEN RAISE EXCEPTION 'private database detail'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER test_menu_audit_failure BEFORE INSERT ON audit_auditevent FOR EACH ROW EXECUTE FUNCTION test_menu_audit_failure();""")
    try:
        response = api.client.patch(item, {"label": "Must roll back"}, content_type="application/json", HTTP_IF_MATCH=token, **api.header)
        assert response.status_code == 503, response.content
        assert response.json()["error"]["code"] == "service_unavailable"
        assert b"private database detail" not in response.content
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER test_menu_audit_failure ON audit_auditevent; DROP FUNCTION test_menu_audit_failure()")
    assert api.client.get(item, **api.header).json()["label"] == "Before"
    assert _tag(api, url) == token


def test_raw_item_writes_are_audited_and_invalidate_api_tokens(api):
    url = _menu(api)
    item = _item(api, url, "Before")
    token = _tag(api, url)
    MenuItem.objects.filter(menu__site=api.site).update(label="System updated")
    response = api.client.patch(item, {"label": "Stale"}, content_type="application/json", HTTP_IF_MATCH=token, **api.header)
    assert response.status_code == 409
    assert AuditEvent.objects.filter(entity_type="cms.menu_item", action="MENU_ITEM_UPDATED", actor_kind="SYSTEM").exists()
    with pytest.raises(IntegrityError), transaction.atomic():
        Menu.objects.filter(site=api.site).update(version=999999)


@pytest.mark.django_db(transaction=True)
def test_two_simultaneous_api_reorders_only_commit_one_version(api):
    url = _menu(api)
    item_urls = [_item(api, url, label) for label in ("A", "B", "C")]
    ids = [api.client.get(item_url, **api.header).json()["id"] for item_url in item_urls]
    token = _tag(api, url)
    barrier = Barrier(2)

    def attempt(order):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout='10s'")
            barrier.wait(timeout=10)
            response = Client().post(url + "reorder/", {"parent": None, "items": order}, content_type="application/json", HTTP_IF_MATCH=token, **api.header)
            return response.status_code, response.json()
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(attempt, order) for order in (list(reversed(ids)), [ids[1], ids[2], ids[0]])]
        results = [future.result(timeout=30) for future in futures]
    assert sorted(code for code, _ in results) == [200, 409], results
    conflict = next(body for code, body in results if code == 409)
    assert conflict["error"]["details"]["reason"] == "version_conflict"
    winner = next(body for code, body in results if code == 200)
    final = api.client.get(url + "tree/", **api.header).json()
    assert [row["id"] for row in final["items"]] == [row["id"] for row in winner["items"]]
    assert AuditEvent.objects.filter(action="MENU_ITEMS_REORDERED").count() == 1


def test_menu_openapi_contract_is_typed_scoped_and_documents_conflicts():
    output = io.StringIO()
    call_command("spectacular", stdout=output, validate=True, fail_on_warn=True)
    schema = yaml.safe_load(output.getvalue())
    base = "/api/v1/sites/{site_pk}/menus/"
    paths = schema["paths"]
    create = paths[base]["post"]
    assert create["tags"] == ["Menus"]
    assert create["security"] == [{"keycloakBearer": []}]
    assert set(create["requestBody"]["content"]) == {"application/json"}
    assert not any(parameter["name"] == "If-Match" for parameter in create["parameters"])
    assert "428" not in create["responses"]
    for path, method in ((base+"{id}/reorder/", "post"), (base+"{menu_pk}/items/{id}/move/", "post"), (base+"{id}/", "patch"), (base+"{menu_pk}/items/{id}/", "delete")):
        operation = paths[path][method]
        assert {"409", "428", "503"} <= set(operation["responses"])
        assert "412" not in operation["responses"]
        assert any(parameter["name"] == "If-Match" and parameter["required"] for parameter in operation["parameters"])
    assert paths[base+"{id}/tree/"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TreeOutput")
