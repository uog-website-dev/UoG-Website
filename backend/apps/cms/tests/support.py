"""Test setup that authorizes workflow through persisted Site roles."""
from apps.cms.models import ContentRole, SiteContentRoleAssignment
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
    SiteContentRoleAssignment.objects.get_or_create(
        site_id=content.site_id,
        user=actor,
        role=_ACTION_ROLE[action],
    )
    return transition_content(
        content.pk, action=action, actor=actor, comment=comment,
    )
