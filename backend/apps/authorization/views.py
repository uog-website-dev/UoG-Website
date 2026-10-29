"""Database-backed authorization administration API."""
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.authentication import KeycloakBearerAuthentication

from .access import (
    assignment_covers_target,
    authorized_assignment_ids,
    is_platform_administrator,
    live_assignments,
)
from .catalog import PLATFORM_ADMIN, STANDARD_ROLES, capability_for
from .models import AuthorizationAuditEvent, Permission, Role, RolePermission, UserRoleAssignment
from .permissions import ManagementPermission
from .serializers import (
    AssignmentCreateSerializer,
    AssignmentSerializer,
    AuthorizationAuditSerializer,
    EffectivePermissionSerializer,
    PermissionSerializer,
    PermissionSetSerializer,
    RoleSerializer,
)
from .services import effective_permissions, permission_granted, record_decision


class AuthorizationViewSet(viewsets.GenericViewSet):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated, ManagementPermission]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    permission_by_action = {}

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response


@extend_schema(tags=["Authorization"])
class PermissionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AuthorizationViewSet):
    queryset = Permission.objects.order_by("module", "code")
    serializer_class = PermissionSerializer
    pagination_class = None
    permission_by_action = {"list": "platform.roles.view", "retrieve": "platform.roles.view"}


@extend_schema(tags=["Authorization"])
@extend_schema_view(
    list=extend_schema(description="Lists standard and custom application roles, with registered active permission codes."),
    create=extend_schema(description="Create a custom role. System role codes are reserved."),
)
class RoleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, AuthorizationViewSet):
    queryset = Role.objects.prefetch_related("permission_links__permission").order_by("is_system", "name", "code")
    serializer_class = RoleSerializer
    permission_by_action = {
        "list": "platform.roles.view", "retrieve": "platform.roles.view",
        "create": "platform.roles.create", "partial_update": "platform.roles.update",
        "update": "platform.roles.update",
        "permissions": {"GET": "platform.roles.view", "PUT": "platform.roles.assign_permissions"},
    }
    lookup_field = "code"

    def get_serializer(self, *args, **kwargs):
        if self.action == "permissions" and "data" in kwargs:
            kwargs["context"] = self.get_serializer_context()
        return super().get_serializer(*args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "permissions" and self.request.method == "PUT":
            return queryset.filter(is_system=False)
        if self.action in {"update", "partial_update"}:
            return queryset.filter(is_system=False)
        if is_platform_administrator(self.request.user):
            return queryset
        codes = set(live_assignments(self.request.user, "platform.roles.view").values_list("role__code", flat=True))
        for code, _name, _description, template_permissions in STANDARD_ROLES:
            if template_permissions and all(
                permission_granted(self.request.user, item, audit=False)
                for item in template_permissions
            ):
                codes.add(code)
        return queryset.filter(code__in=codes)

    def perform_create(self, serializer):
        if "is_active" in serializer.initial_data:
            raise serializers.ValidationError({"is_active": ["Create the role first, then change its active state."]})
        if serializer.validated_data.get("is_active") is False:
            raise serializers.ValidationError({"is_active": ["Custom roles are created active; disable them with PATCH after creation."]})
        role = serializer.save(is_system=False)
        record_decision(user=self.request.user, action="ROLE_CREATED", outcome="CHANGE", role_code=role.code, request=self.request)

    def perform_update(self, serializer):
        before = {"name": serializer.instance.name, "description": serializer.instance.description, "is_active": serializer.instance.is_active}
        if serializer.instance.is_system:
            raise PermissionDenied("System role templates cannot be changed at runtime.")
        with transaction.atomic():
            role = serializer.save()
            record_decision(user=self.request.user, action="ROLE_UPDATED", outcome="CHANGE", role_code=role.code,
                            details={"before": before, "after": {"name": role.name, "description": role.description, "is_active": role.is_active}}, request=self.request)

    @action(detail=True, methods=["get", "put"], url_path="permissions")
    def permissions(self, request, code=None):
        role = self.get_object()
        if request.method == "GET":
            if role.is_system:
                allowed = next((codes for code, _name, _description, codes in STANDARD_ROLES if code == role.code), ())
                permissions = Permission.objects.filter(code__in=allowed, is_active=True).order_by("code")
                permission_codes = sorted(permissions.values_list("code", flat=True))
            else:
                permissions = Permission.objects.filter(role_links__role=role, is_active=True).order_by("code")
                permission_codes = list(permissions.values_list("code", flat=True))
            return Response({"role": RoleSerializer(role).data, "permissions": PermissionSerializer(permissions, many=True).data, "permission_codes": permission_codes})
        if role.is_system:
            raise PermissionDenied("Standard role templates are controlled by code and migrations. Create a custom role to customize permissions.")
        payload = PermissionSetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        permissions = list(Permission.objects.filter(code__in=payload.validated_data["permissions"], is_active=True, is_system=True))
        if not is_platform_administrator(request.user):
            for assigned_code in payload.validated_data["permissions"]:
                capability = capability_for(assigned_code)
                if not capability or not capability.delegable or not permission_granted(request.user, assigned_code, audit=False):
                    raise PermissionDenied("You cannot grant permissions beyond your delegation authority.")
        with transaction.atomic():
            before = list(role.permission_links.values_list("permission__code", flat=True))
            RolePermission.objects.filter(role=role).exclude(permission__in=permissions).delete()
            RolePermission.objects.bulk_create([RolePermission(role=role, permission=permission) for permission in permissions], ignore_conflicts=True)
            record_decision(user=request.user, action="ROLE_PERMISSIONS_REPLACED", outcome="CHANGE", role_code=role.code,
                            details={"before": sorted(before), "after": payload.validated_data["permissions"]}, request=request)
        role.refresh_from_db()
        return Response({"role": RoleSerializer(role).data, "permissions": payload.validated_data["permissions"]})


@extend_schema(tags=["Authorization"])
class AssignmentViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, AuthorizationViewSet):
    queryset = UserRoleAssignment.objects.all()
    serializer_class = AssignmentSerializer
    permission_by_action = {
        "list": "platform.users.view", "create": "platform.users.assign_roles",
        "revoke": "platform.users.assign_roles", "scope": "platform.users.assign_roles",
        "effective": "platform.users.view",
    }

    def get_queryset(self):
        permission_code = "platform.users.view" if self.action in {"list", "effective"} else "platform.users.assign_roles"
        allowed = authorized_assignment_ids(self.request.user, permission_code)
        query = UserRoleAssignment.objects.select_related("user", "role", "organization", "site", "assigned_by", "revoked_by")
        if allowed is None:
            return query
        if not allowed:
            return query.none()
        return query.filter(pk__in=allowed)

    def get_serializer_class(self):
        return AssignmentCreateSerializer if self.action == "create" else AssignmentSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        role = values["role"]
        if values["user"].pk == request.user.pk:
            raise PermissionDenied("You cannot assign a role to yourself.")
        if not is_platform_administrator(request.user):
            # Delegators may only grant capabilities they hold in the exact target scope.
            target_codes = set(role.permission_links.filter(permission__is_active=True, permission__is_system=True).values_list("permission__code", flat=True))
            target_org_id = values.get("organization").pk if values.get("organization") else None
            target_site_id = values.get("site").pk if values.get("site") else None
            if any(
                (capability_for(code) is None or not capability_for(code).delegable)
                or not permission_granted(
                    request.user, code, organization_id=target_org_id, site_id=target_site_id, audit=False,
                )
                for code in target_codes
            ):
                raise PermissionDenied("You cannot assign a role with permissions beyond your authority in the requested scope.")
        scope = values["scope"]
        organization = values.get("organization")
        site = values.get("site")
        target_org_id = organization.pk if organization else None
        target_site_id = site.pk if site else None
        if not is_platform_administrator(request.user):
            delegations = live_assignments(request.user, "platform.users.assign_roles")
            if not any(
                (item.scope == UserRoleAssignment.Scope.ORGANIZATION and assignment_covers_target(item, organization_id=target_org_id, site_id=target_site_id))
                or (item.scope == UserRoleAssignment.Scope.SITE and scope == UserRoleAssignment.Scope.SITE and item.site_id == target_site_id)
                for item in delegations
            ):
                raise PermissionDenied("The requested assignment is outside your delegation scope.")
            if scope == UserRoleAssignment.Scope.PLATFORM:
                raise PermissionDenied("Only a platform administrator may assign platform-wide roles.")
            if role.is_system and role.code == "organization-administrator" and scope != UserRoleAssignment.Scope.ORGANIZATION:
                raise PermissionDenied("Organization Administrator roles require organization scope.")
            if role.is_system and role.code == "site-administrator" and scope != UserRoleAssignment.Scope.SITE:
                raise PermissionDenied("Site Administrator roles require site scope.")
            if role.code == "platform-administrator":
                raise PermissionDenied("Platform administrator assignments require an existing platform administrator.")
        try:
            with transaction.atomic():
                assignment = UserRoleAssignment.objects.create(
                    user=values["user"], role=role, scope=scope, organization=organization, site=site,
                    assigned_by=request.user, expires_at=values.get("expires_at"),
                )
                record_decision(user=request.user, action="ROLE_ASSIGNED", outcome="CHANGE", assignment=assignment,
                                details={"assignment_id": assignment.pk}, request=request)
        except IntegrityError as exc:
            raise serializers.ValidationError({"assignment": ["An active assignment with this role and scope already exists."]}) from exc
        return Response(AssignmentSerializer(assignment).data, status=201)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        assignment = self.get_object()
        if assignment.user_id == request.user.pk:
            raise PermissionDenied("You cannot revoke your own role assignment.")
        if assignment.revoked_at is not None:
            return Response(AssignmentSerializer(assignment).data)
        with transaction.atomic():
            assignment.revoked_at = timezone.now()
            assignment.revoked_by = request.user
            assignment.save(update_fields=["revoked_at", "revoked_by"])
            record_decision(user=request.user, action="ROLE_REVOKED", outcome="CHANGE", assignment=assignment,
                            details={"assignment_id": assignment.pk}, request=request)
        return Response(AssignmentSerializer(assignment).data)

    @action(detail=True, methods=["patch"], url_path="scope")
    def scope(self, request, pk=None):
        assignment = self.get_object()
        if assignment.user_id == request.user.pk:
            raise PermissionDenied("You cannot change your own role assignment.")
        if assignment.revoked_at is not None:
            raise PermissionDenied("Revoked assignments cannot be changed.")
        payload = AssignmentCreateSerializer(data={
            "user": assignment.user_id,
            "role": assignment.role_id,
            "scope": request.data.get("scope", assignment.scope),
            "organization": request.data.get("organization", assignment.organization_id),
            "site": request.data.get("site", assignment.site_id),
            "expires_at": request.data.get("expires_at", assignment.expires_at),
        })
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        if not is_platform_administrator(request.user):
            delegations = live_assignments(request.user, "platform.users.assign_roles")
            new_org_id = values.get("organization").pk if values.get("organization") else None
            new_site_id = values.get("site").pk if values.get("site") else None
            if not any(
                (item.scope == UserRoleAssignment.Scope.ORGANIZATION and assignment_covers_target(item, organization_id=new_org_id, site_id=new_site_id))
                or (item.scope == UserRoleAssignment.Scope.SITE and values["scope"] == UserRoleAssignment.Scope.SITE and item.site_id == new_site_id)
                for item in delegations
            ):
                raise PermissionDenied("The requested assignment is outside your delegation scope.")
            target_codes = set(assignment.role.permission_links.filter(
                permission__is_active=True, permission__is_system=True,
            ).values_list("permission__code", flat=True))
            if any(
                not capability_for(code)
                or not capability_for(code).delegable
                or not permission_granted(
                    request.user, code,
                    organization_id=values.get("organization").pk if values.get("organization") else None,
                    site_id=values.get("site").pk if values.get("site") else None,
                    audit=False,
                ) for code in target_codes
            ):
                raise PermissionDenied("You lack authority over the requested assignment scope.")
        before = {"scope": assignment.scope, "organization": assignment.organization_id, "site": assignment.site_id}
        with transaction.atomic():
            assignment.scope = values["scope"]
            assignment.organization = values.get("organization")
            assignment.site = values.get("site")
            assignment.expires_at = values.get("expires_at", assignment.expires_at)
            assignment.full_clean()
            assignment.save(update_fields=["scope", "organization", "site", "expires_at"])
            record_decision(user=request.user, action="ROLE_SCOPE_CHANGED", outcome="CHANGE", assignment=assignment,
                            details={"before": before, "after": {"scope": assignment.scope,
                                "organization": assignment.organization_id, "site": assignment.site_id}}, request=request)
        return Response(AssignmentSerializer(assignment).data)

    @action(detail=False, methods=["get"], url_path=r"users/(?P<user_id>[^/.]+)/effective")
    def effective(self, request, user_id=None):
        target = get_object_or_404(get_user_model(), pk=user_id, is_active=True)
        scope = request.query_params.get("scope")
        organization_id = request.query_params.get("organization")
        site_id = request.query_params.get("site")
        if scope not in {None, "PLATFORM", "ORGANIZATION", "SITE"}:
            raise serializers.ValidationError({"scope": ["Unknown scope."]})
        if site_id is not None:
            from apps.sites.models import Site
            site = get_object_or_404(Site, pk=_positive_id(site_id, "site"))
            site_id = site.pk
            organization_id = site.organization_unit_id

        if organization_id is not None and not str(organization_id).isdigit():
            raise serializers.ValidationError({"organization": ["Expected an integer identifier."]})
        normalized_org_id = int(organization_id) if organization_id else None
        normalized_site_id = int(site_id) if site_id else None
        if scope == "PLATFORM" and (normalized_org_id is not None or normalized_site_id is not None):
            raise serializers.ValidationError({"scope": ["Platform scope cannot include organization or site identifiers."]})
        if normalized_site_id is not None and normalized_org_id is not None:
            from apps.sites.models import Site
            if not Site.objects.filter(pk=normalized_site_id, organization_unit_id=normalized_org_id).exists():
                raise serializers.ValidationError({"site": ["The site does not belong to the selected organization."]})
        if scope == "ORGANIZATION" and normalized_org_id is None:
            raise serializers.ValidationError({"organization": ["Organization scope requires an organization identifier."]})
        if scope == "SITE" and normalized_site_id is None:
            raise serializers.ValidationError({"site": ["Site scope requires a site identifier."]})
        if not is_platform_administrator(request.user) and target.pk != request.user.pk:
            if not permission_granted(request.user, "platform.users.view", organization_id=normalized_org_id, site_id=normalized_site_id, request=request):
                raise PermissionDenied("You can only inspect users in a scope you are authorized to view.")
        if not is_platform_administrator(request.user) and target.pk == request.user.pk:
            allowed_scopes = live_assignments(request.user)
            if not any(assignment_covers_target(item, organization_id=normalized_org_id, site_id=normalized_site_id) for item in allowed_scopes):
                raise PermissionDenied("The requested effective permissions are outside your assigned scope.")
        permissions = effective_permissions(target, organization_id=normalized_org_id,
                                            site_id=int(site_id) if site_id else None)
        result = {"user": target.pk, "organization": normalized_org_id,
                  "site": normalized_site_id, "permissions": permissions}
        return Response(EffectivePermissionSerializer(result).data)


@extend_schema(tags=["Authorization"])
class AuthorizationAuditViewSet(mixins.ListModelMixin, AuthorizationViewSet):
    queryset = AuthorizationAuditEvent.objects.select_related("actor").order_by("-created_at", "-id")
    serializer_class = AuthorizationAuditSerializer
    permission_by_action = {"list": "audit.logs.view"}

    def get_queryset(self):
        query = super().get_queryset()
        if is_platform_administrator(self.request.user):
            return query
        assignments = live_assignments(self.request.user, "audit.logs.view")
        if any(item.scope == UserRoleAssignment.Scope.PLATFORM for item in assignments):
            return query
        subject_ids = set()
        assignment_ids = authorized_assignment_ids(self.request.user, "audit.logs.view") or []
        subject_ids.update(UserRoleAssignment.objects.filter(pk__in=assignment_ids).values_list("user_id", flat=True))
        for item in assignments:
            if item.scope == UserRoleAssignment.Scope.ORGANIZATION:
                from apps.authorization.access import organization_ids_in_scope
                org_ids = organization_ids_in_scope(item.organization_id)
                subject_ids.update(UserRoleAssignment.objects.filter(organization_id__in=org_ids).values_list("user_id", flat=True))
            elif item.scope == UserRoleAssignment.Scope.SITE:
                subject_ids.update(UserRoleAssignment.objects.filter(site_id=item.site_id).values_list("user_id", flat=True))
        return query.filter(Q(actor=self.request.user) | Q(subject_user_id__in=[str(pk) for pk in subject_ids]))


@extend_schema(tags=["Authorization"])
class EffectivePermissionViewSet(viewsets.GenericViewSet):
    """Self-service permission report; reveals no other users without admin rights."""
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = EffectivePermissionSerializer
    http_method_names = ["get", "head", "options"]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def list(self, request):
        from apps.authorization.access import effective_scope_for_site
        organization_id = request.query_params.get("organization")
        site_id = request.query_params.get("site")
        if site_id is not None:
            site_id = _positive_id(site_id, "site")
            organization_id = effective_scope_for_site(site_id)
            if organization_id is None:
                from rest_framework.exceptions import NotFound
                raise NotFound()
        else:
            organization_id = _positive_id(organization_id, "organization") if organization_id is not None else None
        if site_id is not None:
            site_id = _positive_id(site_id, "site")
            organization_id = effective_scope_for_site(site_id)
            if organization_id is None:
                from rest_framework.exceptions import NotFound
                raise NotFound()
        if not is_platform_administrator(request.user):
            from .access import assignment_covers_target
            assignments = live_assignments(request.user)
            if organization_id is not None or site_id is not None:
                if not any(assignment_covers_target(item, organization_id=organization_id, site_id=site_id) for item in assignments):
                    raise PermissionDenied("The requested scope is outside your authority.")
            elif not assignments.filter(scope=UserRoleAssignment.Scope.PLATFORM).exists():
                raise PermissionDenied("Platform-wide effective permissions require platform scope.")
        permissions = effective_permissions(request.user, organization_id=organization_id, site_id=site_id)
        return Response({"user": request.user.pk, "organization": organization_id, "site": site_id, "permissions": permissions})


def _positive_id(value, field):
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({field: ["Expected an integer identifier."]}) from exc
    if result <= 0:
        raise serializers.ValidationError({field: ["Expected a positive identifier."]})
    return result
