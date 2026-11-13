"""Reviewed reconciliation, guarded schema removal and revocation-safe rollback."""
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from apps.authorization.models import Role,UserRoleAssignment
from apps.cms.authorization import cms_grant_allows
from apps.cms.models import ContentRole,LegacyCMSRoleReconciliation
from apps.cms.services.role_retirement import inventory,reconcile,legacy_model,LEGACY_TABLE

pytestmark=pytest.mark.django_db(transaction=True)


@pytest.fixture
def baseline(sites):
    executor=MigrationExecutor(connection);latest=executor.loader.graph.leaf_nodes()
    executor.migrate([("cms","0021_legacy_role_reconciliation")])
    call_command("seed_rbac",verbosity=0)
    actor=get_user_model().objects.create_user(username="retirement-reviewer")
    UserRoleAssignment.objects.create(user=actor,role=Role.objects.get(code="platform-administrator"),scope="PLATFORM")
    user=get_user_model().objects.create_user(username="legacy-only-user")
    model=legacy_model()
    try:
        yield actor,user,sites[0],sites[1],model
    finally:
        model=legacy_model()
        if model is not None:
            model.objects.all().delete()
        MigrationExecutor(connection).migrate(latest)


def approve(rows,decision="MAPPED"):
    return [{"legacy_id":row["legacy_id"],"fingerprint":row["fingerprint"],"decision":decision,"reason":"Reviewed exact Site-only permission expansion for migration."} for row in rows]


def test_legacy_only_requires_explicit_review_then_is_idempotent_and_revocable(baseline):
    actor,user,site,other,model=baseline
    model.objects.create(user_id=user.pk,site_id=site.pk,role="AUTHOR")
    rows=inventory()
    assert rows[0]["status"]=="REVIEW_REQUIRED" and rows[0]["permission_delta"]
    assert not cms_grant_allows(user,site.pk,[ContentRole.AUTHOR])
    assert reconcile(actor=actor)[0]["status"]=="REVIEW_REQUIRED"
    assert not UserRoleAssignment.objects.filter(user=user).exists()
    reconcile(actor=actor,approvals=approve(rows))
    assignment=UserRoleAssignment.objects.get(user=user)
    assert assignment.scope=="SITE" and assignment.site_id==site.pk and assignment.role.code=="editor"
    assert cms_grant_allows(user,site.pk,[ContentRole.AUTHOR])
    assert not cms_grant_allows(user,other.pk,[ContentRole.AUTHOR])
    assert reconcile(actor=actor)==[]
    from django.utils import timezone
    assignment.revoked_at=timezone.now();assignment.save()
    assert reconcile(actor=actor)==[]
    assert not cms_grant_allows(user,site.pk,[ContentRole.AUTHOR])
    assert model.objects.filter(user_id=user.pk).exists()  # Cannot restore authority.


def test_multiple_approved_roles_preserve_site_scope_without_administrator(baseline):
    actor,user,site,other,model=baseline
    for role in ["AUTHOR","REVIEWER","PUBLISHER"]:
        model.objects.create(user_id=user.pk,site_id=site.pk,role=role)
    reconcile(actor=actor,approvals=approve(inventory()))
    assert set(UserRoleAssignment.objects.filter(user=user).values_list("role__code",flat=True))=={"editor","reviewer","publisher"}
    assert UserRoleAssignment.objects.filter(user=user).exclude(scope="SITE",site=site).count()==0
    assert LegacyCMSRoleReconciliation.objects.filter(reviewer_id=actor.pk,decision="MAPPED").count()==3


def test_covered_grants_and_inactive_users_do_not_gain_new_assignments(baseline):
    actor,user,site,other,model=baseline
    assignment=UserRoleAssignment.objects.create(user=user,site=site,organization=site.organization_unit,scope="SITE",role=Role.objects.get(code="publisher"))
    model.objects.create(user_id=user.pk,site_id=site.pk,role="PUBLISHER")
    disabled=get_user_model().objects.create_user(username="disabled-legacy-user",is_active=False)
    model.objects.create(user_id=disabled.pk,site_id=other.pk,role="AUTHOR")
    outcomes=reconcile(actor=actor)
    assert {row["status"] for row in outcomes}=={"COVERED","RETIRED"}
    assert UserRoleAssignment.objects.filter(user=user).count()==1
    assert not UserRoleAssignment.objects.filter(user=disabled).exists()
    assert LegacyCMSRoleReconciliation.objects.get(decision="COVERED").target_assignment_id==assignment.pk


def test_stale_approvals_and_unmapped_roles_cannot_create_memberships(baseline,monkeypatch):
    actor,user,site,other,model=baseline
    model.objects.create(user_id=user.pk,site_id=site.pk,role="AUTHOR")
    approvals=approve(inventory())
    UserRoleAssignment.objects.create(user=user,site=site,organization=site.organization_unit,scope="SITE",role=Role.objects.get(code="viewer"))
    assert reconcile(actor=actor,approvals=approvals)[0]["status"]=="REVIEW_REQUIRED"
    assert not UserRoleAssignment.objects.filter(user=user,role__code="editor").exists()
    monkeypatch.delitem(__import__('apps.cms.services.role_retirement',fromlist=['MAPPING']).MAPPING,"AUTHOR")
    assert inventory()[0]["target_role"] is None
    with pytest.raises(ValueError,match="missing or inactive"):
        reconcile(actor=actor,approvals=approve(inventory()))


def test_drop_is_guarded_and_rollback_cannot_resurrect_revoked_grant(baseline):
    actor,user,site,other,model=baseline
    model.objects.create(user_id=user.pk,site_id=site.pk,role="REVIEWER")
    with pytest.raises(RuntimeError,match="Unresolved legacy CMS grants"):
        MigrationExecutor(connection).migrate([("cms","0022_retire_legacy_content_roles")])
    assert LEGACY_TABLE in connection.introspection.table_names()
    reconcile(actor=actor,approvals=approve(inventory()))
    MigrationExecutor(connection).migrate([("cms","0022_retire_legacy_content_roles")])
    assert LEGACY_TABLE not in connection.introspection.table_names()
    assert inventory()==[] and reconcile(actor=actor)==[]
    from django.utils import timezone
    UserRoleAssignment.objects.filter(user=user).update(revoked_at=timezone.now())
    MigrationExecutor(connection).migrate([("cms","0021_legacy_role_reconciliation")])
    assert not legacy_model().objects.filter(user_id=user.pk).exists()
    assert not cms_grant_allows(user,site.pk,[ContentRole.REVIEWER])


def test_live_membership_rollback_restores_only_reviewed_grant(baseline):
    actor,user,site,other,model=baseline
    original=model.objects.create(user_id=user.pk,site_id=site.pk,role="PUBLISHER")
    reconcile(actor=actor,approvals=approve(inventory()))
    MigrationExecutor(connection).migrate([("cms","0022_retire_legacy_content_roles")])
    MigrationExecutor(connection).migrate([("cms","0021_legacy_role_reconciliation")])
    restored=legacy_model().objects.get(user_id=user.pk)
    assert restored.role=="PUBLISHER" and restored.pk==original.pk and restored.created_at==original.created_at
    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval(pg_get_serial_sequence('cms_sitecontentroleassignment','id'))")
        assert cursor.fetchone()[0]>original.pk
    assert UserRoleAssignment.objects.filter(user=user,scope="SITE",site=site).count()==1
    MigrationExecutor(connection).migrate([("cms","0022_retire_legacy_content_roles")])
    assert LEGACY_TABLE not in connection.introspection.table_names()
