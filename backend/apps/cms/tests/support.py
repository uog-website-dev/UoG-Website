"""Test setup that authorizes workflow through persisted Site roles."""
from apps.cms.models import ContentRole
from apps.cms.services.workflow import transition_content


_ACTION_ROLE = {
    "submit": ContentRole.AUTHOR,
    "approve": ContentRole.REVIEWER,
    "reject": ContentRole.REVIEWER,
    "publish": ContentRole.PUBLISHER,
    "unpublish": ContentRole.PUBLISHER,
    "archive": ContentRole.PUBLISHER,
    "restore": ContentRole.AUTHOR,
}


def transition_with_site_role(content, action, actor, comment=""):
    """Move content by granting the action's Site role, never a token claim."""
    grant_cms_role(site_id=content.site_id,user=actor,role=_ACTION_ROLE[action])
    return transition_content(
        content.pk, action=action, actor=actor, comment=comment,
    )


def grant_cms_role(*,user,role,site=None,site_id=None):
    """Fixture grants use the same canonical membership as Site Users."""
    from apps.authorization.models import Role,UserRoleAssignment
    from apps.sites.models import Site
    from django.core.management import call_command
    code={"AUTHOR":"editor","REVIEWER":"reviewer","PUBLISHER":"publisher"}[str(role)]
    if not Role.objects.filter(code=code,is_system=True).exists():
        call_command("seed_rbac",verbosity=0)
    site=site or Site.objects.get(pk=site_id)
    return UserRoleAssignment.objects.get_or_create(user=user,site=site,organization_id=site.organization_unit_id,scope="SITE",role=Role.objects.get(code=code),revoked_at=None)[0]
