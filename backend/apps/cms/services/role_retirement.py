"""Explicit, repeatable reconciliation of legacy grants into Site membership."""
import hashlib
import json
from django.db import connections,transaction
from django.db.migrations.loader import MigrationLoader
from django.utils import timezone
from apps.authorization.access import is_platform_administrator,live_assignments
from apps.authorization.models import Role,UserRoleAssignment
from apps.authorization.services import effective_permissions,record_decision
from apps.cms.models import LegacyCMSRoleReconciliation

MAPPING={"AUTHOR":"editor","REVIEWER":"reviewer","PUBLISHER":"publisher"}
LEGACY_TABLE="cms_sitecontentroleassignment"


def legacy_model(using="default"):
    connection=connections[using]
    if LEGACY_TABLE not in connection.introspection.table_names():
        return None
    return MigrationLoader(connection).project_state([("cms","0020_professional_layout_presentation")]).apps.get_model("cms","SiteContentRoleAssignment")


def inventory(using="default"):
    model=legacy_model(using)
    if model is None:
        return []
    from django.contrib.auth import get_user_model
    from apps.sites.models import Site
    result=[]
    for grant in model.objects.using(using).order_by("pk"):
        snapshot={"id":grant.pk,"site_id":grant.site_id,"user_id":grant.user_id,"role":grant.role,"created_at":grant.created_at.isoformat()}
        previous=LegacyCMSRoleReconciliation.objects.using(using).filter(legacy_id=grant.pk).first()
        user=get_user_model().objects.using(using).get(pk=grant.user_id)
        site=Site.objects.using(using).get(pk=grant.site_id)
        code=MAPPING.get(grant.role)
        role=Role.objects.using(using).filter(code=code,is_system=True,is_active=True).first()
        before=effective_permissions(user,site_id=site.pk,organization_id=site.organization_unit_id)
        delta=sorted(set(role.permission_links.filter(permission__is_active=True,permission__is_system=True).values_list("permission__code",flat=True))-set(before)) if role else []
        live=live_assignments(user).using(using).filter(scope="SITE",site_id=site.pk,role__is_system=True,role__code__in=[code,"site-administrator"]).first()
        if previous and previous.snapshot==snapshot:
            status="RECONCILED"
        elif not code:
            status="REVIEW_REQUIRED"
        elif not user.is_active:
            status="RETIRE_INACTIVE"
        elif not code or not role or site.status=="ARCHIVED" or site.organization_unit.status!="ACTIVE":
            status="REVIEW_REQUIRED"
        elif live or is_platform_administrator(user):
            status="COVERED"
        else:
            # Even a zero RBAC delta can add access to another CMS surface.
            status="REVIEW_REQUIRED"
        fingerprint=hashlib.sha256(json.dumps({"snapshot":snapshot,"permission_delta":delta,"before":sorted(before),"status":status},sort_keys=True).encode()).hexdigest()
        result.append({"legacy_id":grant.pk,"snapshot":snapshot,"target_role":code,"status":status,"permission_delta":delta,"effective_permissions_before":sorted(before),"fingerprint":fingerprint,"existing_assignment_id":live.pk if live else None})
    return result


def reconcile(*,actor,approvals=None,using="default"):
    if not is_platform_administrator(actor):
        raise ValueError("An active database Platform Administrator must review reconciliation.")
    approvals={int(row["legacy_id"]):row for row in (approvals or [])}
    outcomes=[]
    # Freeze legacy writes and related membership changes while applying the
    # reviewed report. No automatic mapping of access-expanding grants.
    with transaction.atomic(using=using):
        if legacy_model(using) is None:
            return []
        with connections[using].cursor() as cursor:
            cursor.execute("LOCK TABLE cms_sitecontentroleassignment, authorization_userroleassignment, authorization_role, authorization_rolepermission, auth_user IN SHARE ROW EXCLUSIVE MODE")
        actor.refresh_from_db()
        if not is_platform_administrator(actor):
            raise ValueError("Platform Administrator authority changed before reconciliation.")
        for row in inventory(using):
            if row["status"]=="RECONCILED":
                continue
            approval=approvals.get(row["legacy_id"])
            target_id=row["existing_assignment_id"]
            reason="Existing canonical membership already covers the legacy CMS role."
            decision="COVERED"
            if row["status"]=="RETIRE_INACTIVE":
                decision="RETIRED";reason="Inactive identity: archive without creating a latent membership grant."
            elif row["status"]=="REVIEW_REQUIRED":
                if not approval or approval.get("fingerprint")!=row["fingerprint"] or not approval.get("reason"):
                    outcomes.append({"legacy_id":row["legacy_id"],"status":"REVIEW_REQUIRED"});continue
                decision=approval.get("decision")
                if decision not in {"MAPPED","RETIRED"}:
                    raise ValueError("Approved decisions must be MAPPED or RETIRED.")
                reason=approval["reason"]
                if decision=="MAPPED":
                    from apps.sites.models import Site
                    site=Site.objects.using(using).get(pk=row["snapshot"]["site_id"])
                    role=Role.objects.using(using).filter(code=row["target_role"],is_active=True,is_system=True).first()
                    if role is None:
                        raise ValueError("The proposed target role is missing or inactive; resolve it before approval.")
                    if site.status=="ARCHIVED" or site.organization_unit.status!="ACTIVE":
                        raise ValueError("Cannot map a grant on an ineligible Site.")
                    assignment=UserRoleAssignment.objects.using(using).create(user_id=row["snapshot"]["user_id"],role=role,scope="SITE",site=site,organization_id=site.organization_unit_id,assigned_by=actor)
                    target_id=assignment.pk
            LegacyCMSRoleReconciliation.objects.using(using).create(legacy_id=row["legacy_id"],snapshot=row["snapshot"],fingerprint=row["fingerprint"],decision=decision,permission_delta=row["permission_delta"],target_assignment_id=target_id,reviewer_id=actor.pk,reason=reason)
            record_decision(user=actor,action="LEGACY_CMS_ROLE_RECONCILED",outcome="CHANGE",site_id=row["snapshot"]["site_id"],role_code=row["target_role"] or "",resource_type="legacy_cms_grant",resource_id=row["legacy_id"],details={"decision":decision,"target_assignment_id":target_id,"permission_delta":row["permission_delta"],"reason":reason})
            outcomes.append({"legacy_id":row["legacy_id"],"status":decision})
    return outcomes
