"""Site CMS author options for authorized content editors."""
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone


def site_content_authors(site_id):
    """Return active CMS members for one Site, never a global identity list."""
    from apps.authorization.models import UserRoleAssignment

    user_model = get_user_model()
    now = timezone.now()
    users = user_model.objects.filter(
        is_active=True,
        role_assignments__scope=UserRoleAssignment.Scope.SITE,
        role_assignments__site_id=site_id,
        role_assignments__role__is_active=True,
        role_assignments__role__code__in=("editor", "reviewer", "publisher", "site-administrator"),
        role_assignments__revoked_at__isnull=True,
    ).filter(Q(role_assignments__expires_at__isnull=True) | Q(role_assignments__expires_at__gt=now)).distinct()
    return [{"id": user.pk, "name": user.get_username(), "site": site_id} for user in users.order_by("username", "pk")]
