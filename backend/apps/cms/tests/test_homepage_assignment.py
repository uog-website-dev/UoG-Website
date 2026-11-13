"""Site settings, immutable publications and two trusted hosts."""
from apps.cms.tests.support import grant_cms_role
from copy import deepcopy

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.models import Page, PublishedContentSnapshot
from apps.cms.services.homepage import assign_homepage
from apps.cms.services.publication_cache import current_publication_version
from apps.cms.tests.test_public_site_hosts import _host, _publish
from apps.cms.tests.support import transition_with_site_role
from apps.sites.models import Site, Module
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def pages_module(sites):
    module, _ = Module.objects.get_or_create(code="PAGES", defaults={
        "name":"Pages", "description":"Published Pages", "status":"IMPLEMENTED", "is_enabled":True})
    module.is_enabled = True
    module.save(update_fields=("is_enabled",))
    for site in sites:
        enable_module_for_site(site.pk,module.pk)
    return module


@pytest.fixture
def world(sites, pages_module, settings):
    settings.ALLOWED_HOSTS = ["*"]
    call_command("seed_rbac", verbosity=0)
    a, b = sites
    actor = get_user_model().objects.create_user(username="homepage-admin")
    UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code="site-administrator"),
        scope="SITE", organization=a.organization_unit, site=a)
    client = APIClient(); client.force_authenticate(actor)
    first = _publish(Page.objects.create(site=a, title="Informatics", slug="informatics", is_homepage=True))
    layout = {"schema_version":1,"rows":[{"id":"welcome-row","type":"section","ratios":[60,40],
        "columns":[{"id":"left","type":"column","children":[{"id":"heading","type":"headline","props":{"text":"Welcome","level":2}}]},
                   {"id":"right","type":"column","children":[]}]}]}
    second = _publish(Page.objects.create(site=a, title="Visual welcome", slug="welcome", metadata={"visual_layout":layout}))
    foreign = _publish(Page.objects.create(site=b, title="Medicine", slug="medicine", is_homepage=True))
    draft = Page.objects.create(site=a, title="Private draft", slug="private")
    return a, b, actor, client, first, second, foreign, draft, _host(a), _host(b)


def assign(client, site, page):
    return client.post(f"/api/v1/sites/{site.pk}/pages/{page.pk}/homepage/", {}, format="json")


def root(client, host):
    return client.get("/api/v1/site-context/homepage/", HTTP_HOST=host)


def test_assignment_rejects_draft_foreign_and_preserves_revisions(world):
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    revision = second.revision_number
    snapshot = deepcopy(PublishedContentSnapshot.objects.get(content=second).payload)
    before_b = current_publication_version(b.pk, b.default_language)
    assert root(client,ha).json()["title"] == first.title
    assert root(client,hb).json()["title"] == foreign.title
    assert assign(client,a,first).status_code == 200
    response = assign(client,a,second)
    assert response.status_code == 200, response.content
    assert response.json()["is_homepage"] is True
    a.refresh_from_db(); assert a.homepage_id == second.pk
    second.refresh_from_db(); assert second.revision_number == revision
    assert PublishedContentSnapshot.objects.get(content=second).payload == snapshot
    generation = current_publication_version(a.pk,a.default_language)
    assert assign(client,a,draft).status_code == 400
    assert assign(client,a,foreign).status_code == 404
    assert client.post(f"/api/v1/sites/{a.pk}/pages/{second.pk}/homepage/", {"site":b.pk}, format="json").status_code == 400
    a.refresh_from_db(); assert a.homepage_id == second.pk
    assert current_publication_version(a.pk,a.default_language) == generation
    assert current_publication_version(b.pk,b.default_language) == before_b
    assert root(client,ha).json()["title"] == second.title
    assert root(client,ha).json()["metadata"]["visual_layout"] == snapshot["metadata"]["visual_layout"]
    assert root(client,ha).json()["is_homepage"] is True
    assert root(client,hb).json()["title"] == foreign.title
    event = AuditEvent.objects.filter(action="SITE_HOMEPAGE_ASSIGNED", entity_id=str(a.pk)).order_by("-id").first()
    assert event.before["homepage"] == str(first.pk)
    assert event.after["homepage"] == str(second.pk)
    assert event.actor_id == str(actor.pk)
    assert assign(client,a,second).status_code == 200
    assert AuditEvent.objects.filter(action="SITE_HOMEPAGE_ASSIGNED", entity_id=str(a.pk)).count() == 2
    assert current_publication_version(a.pk,a.default_language) == generation


def test_unpublished_selection_uses_empty_fallback_without_other_site_cache_changes(world):
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    assert assign(client,a,second).status_code == 200
    assert root(client,ha).json()["title"] == second.title
    medicine = root(client,hb)
    transition_with_site_role(second,"unpublish",actor)
    response = root(client,ha)
    assert response.status_code == 404
    assert response["Cache-Control"] == "public, max-age=0, must-revalidate"
    assert draft.title not in response.content.decode()
    again = root(client,hb)
    assert again.json() == medicine.json()
    assert again["X-Publication-Version"] == medicine["X-Publication-Version"]
    a.refresh_from_db(); assert a.homepage_id == second.pk


def test_same_slug_slider_pages_stay_isolated_after_warm_cache_and_reassignment(world):
    """Warm both hosts, share a Page slug with different Slider slide text, then reassign A."""
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    def slider(caption):
        return {"schema_version":1,"rows":[{"id":"row","type":"section","ratios":[100],"columns":[{
            "id":"col","type":"column","children":[{"id":"slider","type":"layout_slider","props":{"items":[
                {"id":"slide-1","children":[{"id":"slide-heading","type":"headline","props":{"text":caption,"level":2}}]},
            ]}}]}]}]}
    info_page = _publish(Page.objects.create(
        site=a, title="Informatics campus", slug="campus",
        metadata={"visual_layout": slider("Informatics slide")},
    ))
    med_page = _publish(Page.objects.create(
        site=b, title="Medicine campus", slug="campus",
        metadata={"visual_layout": slider("Medicine slide")},
    ))
    assert assign(client, a, info_page).status_code == 200
    # Medicine administrator assignment uses the Site B homepage API under the same actor scope:
    # foreign-site POST is 404; set Medicine homepage through its own Site admin grant.
    UserRoleAssignment.objects.create(
        user=actor, role=Role.objects.get(code="site-administrator"),
        scope="SITE", organization=b.organization_unit, site=b,
    )
    assert assign(client, b, med_page).status_code == 200

    warm_a = root(client, ha)
    warm_b = root(client, hb)
    page_a = client.get("/api/v1/site-context/pages/campus/", HTTP_HOST=ha)
    page_b = client.get("/api/v1/site-context/pages/campus/", HTTP_HOST=hb)
    assert warm_a.status_code == 200 and warm_b.status_code == 200
    assert page_a.json()["title"] == "Informatics campus"
    assert page_b.json()["title"] == "Medicine campus"
    assert "Informatics slide" in str(page_a.json()["metadata"]["visual_layout"])
    assert "Medicine slide" in str(page_b.json()["metadata"]["visual_layout"])
    medicine_version = warm_b["X-Publication-Version"]
    medicine_body = warm_b.json()

    assert assign(client, a, second).status_code == 200
    after_a = root(client, ha)
    after_b = root(client, hb)
    after_page_b = client.get("/api/v1/site-context/pages/campus/", HTTP_HOST=hb)
    assert after_a.json()["title"] == second.title
    assert after_b.json() == medicine_body
    assert after_b["X-Publication-Version"] == medicine_version
    assert after_page_b.json()["title"] == "Medicine campus"
    assert "Medicine slide" in str(after_page_b.json()["metadata"]["visual_layout"])
    assert "Informatics slide" not in str(after_page_b.json()["metadata"]["visual_layout"])


def test_permission_module_and_database_backstops(world, pages_module):
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    outsider = get_user_model().objects.create_user(username="no-settings")
    client.force_authenticate(outsider)
    assert assign(client,a,second).status_code == 403
    client.force_authenticate(actor)
    assert assign(client,b,foreign).status_code == 403
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=a.pk).update(homepage_id=foreign.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=a.pk).update(homepage_id=draft.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('sites.homepage_assignment','on',true)")
        Site.objects.filter(pk=a.pk).update(homepage_id=foreign.pk)
    disable_module_for_site(a.pk,pages_module.pk)
    assert assign(client,a,second).status_code == 400
    assert root(client,ha).status_code == 404
    a.refresh_from_db(); assert a.homepage_id is None


def test_assignment_and_cache_generation_roll_back_together(world):
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    generation = current_publication_version(a.pk,a.default_language)
    with pytest.raises(RuntimeError), transaction.atomic():
        assign_homepage(site_id=a.pk,page_id=second.pk,actor=actor)
        raise RuntimeError("injected failure")
    a.refresh_from_db(); assert a.homepage_id is None
    assert current_publication_version(a.pk,a.default_language) == generation
    assert not AuditEvent.objects.filter(action="SITE_HOMEPAGE_ASSIGNED").exists()


@pytest.mark.django_db(transaction=True)
def test_assignment_serializes_with_unpublication(world):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.core.exceptions import ValidationError
    from django.db import close_old_connections, connections
    from apps.cms.models import ContentRole
    from apps.cms.services.workflow import transition_content
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    grant_cms_role(site=a,user=actor,role=ContentRole.PUBLISHER)
    barrier = Barrier(2)
    def operation(assigning):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            if assigning:
                try:
                    assign_homepage(site_id=a.pk,page_id=second.pk,actor=actor)
                    return "assigned"
                except ValidationError:
                    return "ineligible"
            transition_content(second.pk,action="unpublish",actor=actor)
            return "unpublished"
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        left = pool.submit(operation,True); right = pool.submit(operation,False)
        result = left.result(timeout=30); assert right.result(timeout=30) == "unpublished"
    a.refresh_from_db(); second.refresh_from_db()
    assert second.status == "UNPUBLISHED"
    if result == "assigned":
        assert a.homepage_id == second.pk and root(client,ha).status_code == 404
    else:
        assert a.homepage_id is None and root(client,ha).json()["title"] == first.title


@pytest.mark.django_db(transaction=True)
def test_upgrade_preserves_existing_homepage_and_readable_snapshot(world):
    from django.db.migrations.executor import MigrationExecutor
    a,b,actor,client,first,second,foreign,draft,ha,hb = world
    latest = MigrationExecutor(connection).loader.graph.leaf_nodes()
    try:
        MigrationExecutor(connection).migrate([("sites","0009_module_integrity"), ("cms","0015_revision_bound_publication")])
        MigrationExecutor(connection).migrate(latest)
        a.refresh_from_db(); b.refresh_from_db()
        assert a.homepage_id == first.pk and b.homepage_id == foreign.pk
        assert root(client,ha).json()["title"] == first.title
        assert root(client,hb).json()["title"] == foreign.title
    finally:
        MigrationExecutor(connection).migrate(latest)
