"""Authorization management endpoints under /api/v1/authorization/."""
from rest_framework.routers import SimpleRouter

from .views import (
    AssignmentViewSet,
    AuthorizationAuditViewSet,
    EffectivePermissionViewSet,
    PermissionViewSet,
    RoleViewSet,
)

app_name = "authorization"
router = SimpleRouter()
router.register("permissions", PermissionViewSet, basename="permission")
router.register("roles", RoleViewSet, basename="role")
router.register("assignments", AssignmentViewSet, basename="assignment")
router.register("audit", AuthorizationAuditViewSet, basename="audit")
router.register("me/permissions", EffectivePermissionViewSet, basename="effective-permissions")
urlpatterns = router.urls
