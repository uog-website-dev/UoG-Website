"""Workflow controls derived from the Site roles the workflow service enforces."""
from .models import ContentRole, ContentStatus, SiteContentRoleAssignment


def available_workflow_actions(content, request):
    """Return actions the authenticated caller may attempt for this content.

    The workflow service stays authoritative. This list only drives controls
    and uses the same Site role assignments, including the rule that an
    author cannot review their own submission.
    """
    user = getattr(request, "user", None) if request is not None else None
    if not getattr(user, "is_authenticated", False):
        return []
    is_admin = getattr(request, "_cms_is_platform_admin", None)
    if is_admin is None:
        try:
            from apps.authorization.access import is_platform_administrator
            is_admin = is_platform_administrator(user)
        except (ImportError, AttributeError):
            is_admin = False
        request._cms_is_platform_admin = is_admin
    if is_admin:
        content_roles = set(ContentRole.values)
    else:
        roles_by_site = getattr(request, "_cms_content_roles_by_site", {})
        if content.site_id not in roles_by_site:
            roles_by_site[content.site_id] = set(
                SiteContentRoleAssignment.objects.filter(
                    site_id=content.site_id, user_id=user.pk, user__is_active=True,
                ).values_list("role", flat=True)
            )
            request._cms_content_roles_by_site = roles_by_site
        content_roles = roles_by_site[content.site_id]

    actions = []
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
