"""Workflow controls derived from the Site roles the workflow service enforces."""
from .models import ContentRole, ContentStatus
from .authorization import cms_grant_allows


def available_workflow_actions(content, request):
    """Return actions the authenticated caller may attempt for this content.

    The workflow service stays authoritative. This list only drives controls
    and uses the same Site role assignments, including the rule that an
    author cannot review their own submission.
    """
    user = getattr(request, "user", None) if request is not None else None
    if not getattr(user, "is_authenticated", False):
        return []
    content_roles = {role for role in ContentRole.values if cms_grant_allows(user,content.site_id,[role])}

    actions = []
    if content.status == ContentStatus.APPROVED and "visual_layout" in content.metadata and ContentRole.AUTHOR in content_roles:
        actions.append("revise")
    if content.status == ContentStatus.DRAFT and ContentRole.AUTHOR in content_roles:
        actions.append("submit")
    if (
        content.status == ContentStatus.IN_REVIEW
        and ContentRole.REVIEWER in content_roles
        and user.pk not in {content.created_by_id, content.submitted_by_id}
    ):
        actions.extend(("approve", "reject"))
    if content.status == ContentStatus.APPROVED and ContentRole.PUBLISHER in content_roles:
        actions.append("publish")
    if content.status == ContentStatus.PUBLISHED and ContentRole.PUBLISHER in content_roles:
        actions.append("unpublish")
    if (
        content.status in {
            ContentStatus.APPROVED, ContentStatus.PUBLISHED, ContentStatus.UNPUBLISHED,
        }
        and ContentRole.PUBLISHER in content_roles
    ):
        actions.append("archive")
    if content.status == ContentStatus.UNPUBLISHED and ContentRole.AUTHOR in content_roles:
        actions.append("restore")
    return actions
