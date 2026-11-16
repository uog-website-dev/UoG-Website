"""Workflow controls derived from the Site roles the workflow service enforces."""
from .models import ContentRole, ContentStatus
from .authorization import cms_grant_allows


def available_workflow_actions(content, request, *, context=None):
    """Return actions the authenticated caller may attempt for this content.

    The workflow service stays authoritative. This list only drives controls
    and uses the same Site role assignments, including the rule that an
    author cannot review their own submission.
    """
    user = getattr(request, "user", None) if request is not None else None
    if not getattr(user, "is_authenticated", False):
        return []
    # A serializer's context lives for one response only. Do not persist this
    # snapshot on the user/request or reuse it for a subsequent write decision.
    key = (user.pk, content.site_id)
    snapshots = context.setdefault("workflow_role_snapshots", {}) if context is not None else {}
    if key not in snapshots:
        snapshots[key] = {role for role in ContentRole.values if cms_grant_allows(user, content.site_id, [role])}
    content_roles = snapshots[key]

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
