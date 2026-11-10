"""Central module management: Site activation matrix, bulk preview/apply, history.

Every endpoint requires platform.sites.manage_registry (platform scope only).
Central operations use explicit platform authorization in every environment.
"""
import uuid

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DomainValidationError
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiExample, OpenApiParameter, OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import mixins, serializers
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.authorization.permissions import ManagementPermission

from ..models import Module, Site, SiteModuleOperation, SiteModuleOperationChange
from ..services import module_bulk
from .access import AdministrationViewSet, translate_domain_errors
from .query import QuerySerializer
from .serializers import StrictFields

PERMISSION = "platform.sites.manage_registry"
STATES = SiteModuleOperationChange.State
ACTIVATION = [STATES.ENABLED, STATES.DISABLED, STATES.NOT_ASSIGNED]
Scope = SiteModuleOperation.ScopeType


class Rejected(APIException):
    def __init__(self, error):
        super().__init__(error.message)
        self.status_code = error.status
        self.detail = {"reason": error.reason, "message": error.message, **error.details}


# Requests ----------------------------------------------------------------------

class SiteFilterSerializer(serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    status = serializers.ChoiceField(choices=Site.Status.choices, required=False)
    organization = serializers.IntegerField(required=False, min_value=1)
    include_descendants = serializers.BooleanField(required=False, default=False)
    site = serializers.IntegerField(required=False, min_value=1)
    module = serializers.CharField(required=False, max_length=64)
    activation = serializers.ChoiceField(choices=ACTIVATION, required=False)

    def validate_module(self, value):
        value = value.strip().upper()
        if not Module.objects.filter(code=value).exists():
            raise serializers.ValidationError("Unknown module code.")
        return value

    def validate(self, attrs):
        if attrs.get("activation") and not attrs.get("module"):
            raise serializers.ValidationError({"activation": ["Choose a module to filter by activation."]})
        if attrs.get("include_descendants") and not attrs.get("organization"):
            attrs["include_descendants"] = False
        return attrs


class SiteActivationQuerySerializer(QuerySerializer, SiteFilterSerializer):
    ordering = None


class ScopeFilterSerializer(StrictFields, SiteFilterSerializer):
    pass


class ScopeSerializer(StrictFields, serializers.Serializer):
    type = serializers.ChoiceField(choices=Scope.choices)
    site_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)
    organization = serializers.IntegerField(required=False, min_value=1)
    include_descendants = serializers.BooleanField(required=False, default=False)
    filters = ScopeFilterSerializer(required=False)

    def to_internal_value(self, data):
        attrs = super().to_internal_value(data)
        kind = attrs["type"]
        allowed = {
            Scope.SITE: {"type", "site_ids"}, Scope.SELECTED: {"type", "site_ids"},
            Scope.ALL: {"type"}, Scope.ORGANIZATION: {"type", "organization", "include_descendants"},
            Scope.FILTER: {"type", "filters"},
        }[kind]
        extra = set(data) - allowed
        if extra:
            raise serializers.ValidationError({key: ["This field does not apply to the selected scope."] for key in extra})
        return attrs

    def validate(self, attrs):
        kind, site_ids = attrs["type"], attrs.get("site_ids") or []
        if kind == Scope.SITE and len(site_ids) != 1:
            raise serializers.ValidationError({"site_ids": ["Choose exactly one Site."]})
        if kind == Scope.SELECTED and not site_ids:
            raise serializers.ValidationError({"site_ids": ["Choose at least one Site."]})
        if kind == Scope.ORGANIZATION and not attrs.get("organization"):
            raise serializers.ValidationError({"organization": ["Choose an Organization."]})
        return attrs


class PreviewRequestSerializer(StrictFields, serializers.Serializer):
    action = serializers.ChoiceField(choices=SiteModuleOperation.Action.choices)
    modules = serializers.ListField(child=serializers.CharField(max_length=64), min_length=1, max_length=module_bulk.MAX_MODULES_PER_OPERATION)
    scope = ScopeSerializer()

    def validate_modules(self, value):
        return sorted({code.strip().upper() for code in value})


class ApplyRequestSerializer(StrictFields, serializers.Serializer):
    # Selected scopes carry their explicit Site IDs in the signed token; do not
    # impose a smaller size ceiling than Django's request-body limit.
    preview_token = serializers.CharField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")
    confirmation = serializers.CharField(required=False, allow_blank=True, max_length=20, default="")


class OperationQuerySerializer(QuerySerializer):
    ordering = None
    action = serializers.ChoiceField(choices=SiteModuleOperation.Action.choices, required=False)
    module = serializers.CharField(required=False, max_length=64)
    site = serializers.IntegerField(required=False, min_value=1)


# Responses ---------------------------------------------------------------------

class ReasonSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    module = serializers.CharField(required=False, help_text="The related module for dependency reasons.")


class PairSerializer(serializers.Serializer):
    code = serializers.CharField()
    previous_state = serializers.ChoiceField(choices=STATES.choices)
    new_state = serializers.ChoiceField(choices=STATES.choices)
    outcome = serializers.ChoiceField(choices=["CHANGE", "UNCHANGED", "BLOCKED"])
    reasons = ReasonSerializer(many=True)


class OrganizationRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class PreviewSiteSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    status = serializers.ChoiceField(choices=Site.Status.choices)
    organization = OrganizationRefSerializer()
    outcome = serializers.ChoiceField(choices=["CHANGE", "UNCHANGED", "BLOCKED", "PARTIAL"])
    modules = PairSerializer(many=True)


class BlockedReasonSerializer(serializers.Serializer):
    code = serializers.CharField()
    count = serializers.IntegerField()
    message = serializers.CharField()


class SummarySerializer(serializers.Serializer):
    matched_sites = serializers.IntegerField()
    eligible_sites = serializers.IntegerField(help_text="Sites with at least one expected change.")
    already_in_state_sites = serializers.IntegerField()
    blocked_sites = serializers.IntegerField(help_text="Sites with at least one blocked module. Their blocked modules are skipped.")
    expected_changes = serializers.IntegerField(help_text="Site-module pairs that apply will change.")
    unchanged_pairs = serializers.IntegerField()
    blocked_pairs = serializers.IntegerField()
    blocked_reasons = BlockedReasonSerializer(many=True)


class ModuleRefSerializer(serializers.Serializer):
    code = serializers.CharField()
    name = serializers.CharField()
    implementation_status = serializers.ChoiceField(choices=["AVAILABLE", "PLANNED", "DEPRECATED", "IMPLEMENTED_DISABLED"])


class WarningSerializer(serializers.Serializer):
    module = serializers.CharField()
    message = serializers.CharField()


class PreviewResponseSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=SiteModuleOperation.Action.choices)
    modules = ModuleRefSerializer(many=True)
    scope = serializers.JSONField()
    summary = SummarySerializer()
    dependency_warnings = WarningSerializer(many=True)
    high_impact = serializers.BooleanField(help_text="When true, apply requires a reason and confirmation equal to confirmation_phrase.")
    confirmation_phrase = serializers.CharField()
    sites = PreviewSiteSerializer(many=True)
    preview_token = serializers.CharField(help_text="Signed plan fingerprint. Send it to bulk-apply unchanged.")
    expires_in = serializers.IntegerField(help_text="Seconds until the preview token expires.")


class ActivationSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField()
    status = serializers.ChoiceField(choices=Module.Status.choices)
    implementation_status = serializers.ChoiceField(choices=["AVAILABLE", "PLANNED", "DEPRECATED", "IMPLEMENTED_DISABLED"])
    is_shipped = serializers.BooleanField()
    platform_enabled = serializers.BooleanField()
    enabled_sites = serializers.IntegerField()
    disabled_sites = serializers.IntegerField()
    eligible_sites = serializers.IntegerField(help_text="Non-archived Sites that can use the module now. Zero when the module is unavailable.")
    total_sites = serializers.IntegerField()
    requires = serializers.ListField(child=serializers.CharField())
    required_by = serializers.ListField(child=serializers.CharField())
    updated_at = serializers.DateTimeField()


class SiteActivationSerializer(serializers.ModelSerializer):
    organization = serializers.SerializerMethodField()
    modules = serializers.SerializerMethodField()

    class Meta:
        model = Site
        fields = ("id", "code", "name", "status", "organization", "modules")

    def get_organization(self, site) -> dict:
        unit = site.organization_unit
        return {"id": unit.pk, "code": unit.code, "name": unit.name}

    def get_modules(self, site) -> dict:
        return self.context["states"].get(site.pk, {})


class ChangeSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source="site.code")
    site_name = serializers.CharField(source="site.name")
    module = serializers.CharField(source="module.code")

    class Meta:
        model = SiteModuleOperationChange
        fields = ("site", "site_code", "site_name", "module", "previous_state", "new_state")


class OperationSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = SiteModuleOperation
        fields = (
            "id", "action", "module_codes", "scope_type", "scope", "reason", "actor", "request_id",
            "matched_count", "changed_site_count", "unchanged_count", "blocked_count", "change_count", "created_at",
        )

    def get_actor(self, operation) -> dict:
        names = self.context.get("actors", {})
        return {"id": operation.actor_id, "username": names.get(operation.actor_id, "")}


class OperationDetailSerializer(OperationSerializer):
    changes = ChangeSerializer(many=True)

    class Meta(OperationSerializer.Meta):
        fields = (*OperationSerializer.Meta.fields, "changes")


class ApplyResponseSerializer(serializers.Serializer):
    replayed = serializers.BooleanField(help_text="True when this Idempotency-Key already committed; nothing changed again.")
    operation = OperationDetailSerializer()


def _actor_names(operations):
    ids = {op.actor_id for op in operations if str(op.actor_id).isdigit()}
    users = get_user_model().objects.filter(pk__in=ids).values_list("pk", "username")
    return {str(pk): username for pk, username in users}


REJECTION = {"$ref": "#/components/schemas/APIError"}
EXAMPLE_PREVIEW = OpenApiExample(
    "Enable Posts for two Sites",
    request_only=True,
    value={"action": "ENABLE", "modules": ["POSTS"], "scope": {"type": "SELECTED", "site_ids": [2, 3]}},
)
EXAMPLE_ORGANIZATION = OpenApiExample(
    "Disable Menus for an Organization and its descendants",
    request_only=True,
    value={"action": "DISABLE", "modules": ["MENUS"], "scope": {"type": "ORGANIZATION", "organization": 6, "include_descendants": True}},
)
EXAMPLE_STALE = OpenApiExample(
    "Stale preview", response_only=True, status_codes=["409"],
    value={"error": {"code": "conflict", "message": "The request conflicts with the current resource state.",
                     "details": {"reason": "stale_preview", "message": "Sites or modules changed after the preview. Review the new preview before applying.", "summary": {}}},
           "request_id": "1ea47c51-f2d7-402b-ad9a-4df619d03055"},
)
IDEMPOTENCY_KEY = OpenApiParameter(
    "Idempotency-Key", uuid.UUID, OpenApiParameter.HEADER, required=True,
    description="Client-generated UUID for this confirmed operation. Repeating it returns the committed result; reusing it for a different request returns 409.",
)


class CentralAccess(AdministrationViewSet):
    permission_classes = [IsAuthenticated, ManagementPermission]
    permission_by_action = {
        "list": PERMISSION, "retrieve": PERMISSION, "bulk_preview": PERMISSION, "bulk_apply": PERMISSION,
    }

    def handle_exception(self, exc):
        response = super().handle_exception(exc)
        if response.status_code in {400, 401, 403, 409}:
            detail = getattr(exc, "detail", {})
            reason = detail.get("reason") if isinstance(detail, dict) else None
            reason = reason or ("permission_denied" if response.status_code in {401, 403} else "validation_failed")
            try:
                key = uuid.UUID(str(self.request.headers.get("Idempotency-Key")))
            except (TypeError, ValueError):
                key = None
            # One durable rejection after rollback; never persist submitted
            # bodies, signed tokens, arbitrary headers or credentials.
            module_bulk.record_rejection(self.request.user, reason_code=reason, idempotency_key=key)
        return response


@extend_schema(tags=["Module management"])
@extend_schema_view(list=extend_schema(
    parameters=[
        OpenApiParameter("search", str, description="Site code or name substring."),
        OpenApiParameter("status", str, enum=Site.Status.values),
        OpenApiParameter("organization", int, description="Owning Organization."),
        OpenApiParameter("include_descendants", bool, description="With organization, include Sites of descendant Organizations."),
        OpenApiParameter("site", int),
        OpenApiParameter("module", str, description="Module code; required with activation."),
        OpenApiParameter("activation", str, enum=ACTIVATION),
        OpenApiParameter("page", int, description="Page number. Page size is 20."),
    ],
    responses=SiteActivationSerializer(many=True),
    description="Platform admin only. Sites with each module's activation state, read from SiteModule. Modules absent from `modules` are NOT_ASSIGNED.",
))
class SiteModuleManagementViewSet(mixins.ListModelMixin, CentralAccess):
    queryset = Site.objects.select_related("organization_unit").order_by("code")
    serializer_class = SiteActivationSerializer

    def list(self, request, *args, **kwargs):
        query = SiteActivationQuerySerializer(data=request.query_params, context={"ordering_fields": ()})
        query.is_valid(raise_exception=True)
        try:
            queryset = module_bulk.filter_sites(self.get_queryset(), query.validated_data)
        except module_bulk.BulkOperationError as error:
            raise Rejected(error) from error
        page = self.paginate_queryset(queryset)
        states = module_bulk.module_states_for_sites([site.pk for site in page])
        return self.get_paginated_response(SiteActivationSerializer(page, many=True, context={"states": states}).data)

    @extend_schema(
        request=PreviewRequestSerializer, responses={200: PreviewResponseSerializer, 400: OpenApiResponse(description="Invalid scope, unknown module or Site.", response=REJECTION)},
        examples=[EXAMPLE_PREVIEW, EXAMPLE_ORGANIZATION],
        description=(
            "Platform admin only. Computes, without writing, which Site-module pairs would change, which are already in the "
            "requested state, and which are blocked and why. Enable requires a module that is implemented, shipped, enabled "
            "platform-wide and not deprecated, a non-archived Site, and satisfied dependencies. Disable is blocked while an "
            "enabled module on the Site depends on the module. Returns a signed preview_token for bulk-apply."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk-preview")
    def bulk_preview(self, request):
        payload = PreviewRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        try:
            body = module_bulk.preview(request.user, action=data["action"], module_codes=data["modules"], scope=_scope(data["scope"]))
        except module_bulk.BulkOperationError as error:
            raise Rejected(error) from error
        return Response(body, headers={"Cache-Control": "private, no-store"})

    @extend_schema(
        parameters=[IDEMPOTENCY_KEY], request=ApplyRequestSerializer,
        responses={
            201: ApplyResponseSerializer, 200: ApplyResponseSerializer,
            409: OpenApiResponse(description="Stale or expired preview, or a reused Idempotency-Key. Nothing changed.", response=REJECTION),
        },
        examples=[EXAMPLE_STALE],
        description=(
            "Platform admin only. Recomputes the plan under row locks and commits every "
            "expected change, its history rows and audit events in one transaction, or nothing. Blocked pairs are skipped. "
            "A plan that differs from the preview returns 409 stale_preview. High-impact operations need a reason and "
            "confirmation equal to the preview's confirmation_phrase. Content is never deleted."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk-apply")
    def bulk_apply(self, request):
        key = _idempotency_key(request)
        payload = ApplyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        try:
            with translate_domain_errors():
                operation, replayed = module_bulk.apply(
                    request.user, token=data["preview_token"], idempotency_key=key, reason=data["reason"],
                    confirmation=data["confirmation"].strip().upper(), request_id=getattr(request, "request_id", None),
                )
        except module_bulk.BulkOperationError as error:
            raise Rejected(error) from error
        operation = SiteModuleOperation.objects.prefetch_related(_changes()).get(pk=operation.pk)
        body = {"replayed": replayed, "operation": OperationDetailSerializer(operation, context={"actors": _actor_names([operation])}).data}
        return Response(body, status=200 if replayed else 201, headers={"Cache-Control": "private, no-store"})


def _changes():
    return Prefetch("changes", queryset=SiteModuleOperationChange.objects.select_related("site", "module").order_by("site__code", "module__code"))


def _scope(data):
    scope = {"type": data["type"]}
    if data.get("site_ids"):
        scope["site_ids"] = data["site_ids"]
    if data["type"] == Scope.ORGANIZATION:
        scope.update(organization=data["organization"], include_descendants=data.get("include_descendants", False))
    if data["type"] == Scope.FILTER:
        scope["filters"] = dict(data.get("filters") or {})
    return scope


def _idempotency_key(request):
    supplied = request.headers.get("Idempotency-Key")
    try:
        return uuid.UUID(str(supplied))
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({"Idempotency-Key": ["Send a UUID Idempotency-Key with each confirmed operation."]}) from exc


@extend_schema(tags=["Module management"])
@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("action", str, enum=SiteModuleOperation.Action.values),
            OpenApiParameter("module", str, description="Operations that included this module code."),
            OpenApiParameter("site", int, description="Operations that changed this Site."),
            OpenApiParameter("page", int, description="Page number. Page size is 20."),
        ],
        description="Platform admin only. Newest first. Operation history is append-only.",
    ),
    retrieve=extend_schema(responses=OperationDetailSerializer, description="Platform admin only. Includes every Site-module change with previous and new state."),
)
class ModuleOperationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, CentralAccess):
    queryset = SiteModuleOperation.objects.order_by("-created_at", "-id")
    serializer_class = OperationSerializer

    def list(self, request, *args, **kwargs):
        query = OperationQuerySerializer(data=request.query_params, context={"ordering_fields": ()})
        query.is_valid(raise_exception=True)
        queryset = self.get_queryset()
        data = query.validated_data
        if data.get("action"):
            queryset = queryset.filter(action=data["action"])
        if data.get("module"):
            queryset = queryset.filter(module_codes__contains=[data["module"].strip().upper()])
        if data.get("site"):
            queryset = queryset.filter(changes__site_id=data["site"]).distinct()
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(OperationSerializer(page, many=True, context={"actors": _actor_names(page)}).data)

    def retrieve(self, request, *args, **kwargs):
        operation = get_object_or_404(self.get_queryset().prefetch_related(_changes()), pk=self._operation_id())
        return Response(OperationDetailSerializer(operation, context={"actors": _actor_names([operation])}).data)

    def _operation_id(self):
        try:
            return uuid.UUID(str(self.kwargs["pk"]))
        except ValueError as exc:
            from rest_framework.exceptions import NotFound
            raise NotFound() from exc
