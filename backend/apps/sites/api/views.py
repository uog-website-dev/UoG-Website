"""Restricted Site administration API. Production writes await scoped IAM/RBAC."""
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.authorization.access import authorized_site_ids, authorized_organization_ids
from apps.organizations.hierarchy_lock import hierarchy_write

from ..models import Module, Site, SiteDomain, SiteModule, SiteTemplate
from ..services.configuration import apply_site_configuration
from ..services.domains import activate_domain, deactivate_domain, designate_primary, domain_write
from ..services.lifecycle import transition_site
from ..services.modules import disable_module_for_site, enable_module_for_site
from .access import AdministrationViewSet, Conflict, reject_idempotency, translate_domain_errors
from .query import (
    LIST_PARAMETERS, DomainQuerySerializer, ModuleQuerySerializer, SiteModuleQuerySerializer,
    SiteQuerySerializer, TemplateQuerySerializer, apply_filters,
)
from .serializers import (
    DomainDeactivateSerializer, EmptyObjectSerializer, ModuleSerializer, ModuleUpdateSerializer, SiteCreateSerializer,
    SiteDomainSerializer, SiteDomainUpdateSerializer, SiteModuleSerializer, SiteSerializer,
    SiteTemplateSerializer, SiteTemplateUpdateSerializer, SiteUpdateSerializer,
)

IF_MATCH = OpenApiParameter("If-Match", str, OpenApiParameter.HEADER, required=True, description="Exact strong ETag from GET detail.")
EMPTY = {"application/json": {"type": "object", "additionalProperties": False, "maxProperties": 0}}


def _list(view, serializer, specs, default):
    payload = serializer(data=view.request.query_params, context={"ordering_fields": specs[0]})
    payload.is_valid(raise_exception=True)
    queryset = apply_filters(view.filter_queryset(view.get_queryset()), payload.validated_data, specs[1], default)
    page = view.paginate_queryset(queryset)
    if page is not None:
        return view.get_paginated_response(view.get_serializer(page, many=True).data)
    return Response(view.get_serializer(queryset, many=True).data)


@extend_schema(tags=["Sites"])
@extend_schema_view(
    list=extend_schema(parameters=[*LIST_PARAMETERS, OpenApiParameter("status", str, enum=Site.Status.values), OpenApiParameter("organization_unit", int)], description="Requires sites.view and returns only authorized site scopes. Page size 20, ordered by code."),
    retrieve=extend_schema(description="Requires sites.view in this Site scope. Returns a strong ETag."),
    create=extend_schema(description="Requires sites.create in the target organization scope and the existing development-only write gate."),
    partial_update=extend_schema(parameters=[IF_MATCH], description="Requires sites.update in this Site scope and the existing development-only write gate."),
)
class SiteViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AdministrationViewSet):
    queryset = Site.objects.select_related("organization_unit", "template").order_by("code")
    serializer_class = SiteSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "create":
            return queryset
        code = self.permission_by_action.get(self.action, "sites.view")
        allowed = authorized_site_ids(self.request.user, code)
        if allowed is None:
            return queryset
        org_ids = authorized_organization_ids(self.request.user, code) or []
        return queryset.filter(Q(pk__in=allowed) | Q(organization_unit_id__in=org_ids))


    def get_serializer_class(self):
        if self.action == "create":
            return SiteCreateSerializer
        if self.action == "partial_update":
            return SiteUpdateSerializer
        return SiteSerializer

    def list(self, request, *args, **kwargs):
        return _list(self, SiteQuerySerializer, (("code", "name", "status", "created_at", "updated_at"), (("code", "code"), ("status", "status"), ("organization_unit", "organization_unit_id"))), "code")

    def retrieve(self, request, *args, **kwargs):
        return self.respond(self.get_object(), serializer_class=SiteSerializer)

    def create(self, request, *args, **kwargs):
        reject_idempotency(request)
        with translate_domain_errors(), hierarchy_write():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            site = serializer.save()
        return self.respond(site, serializer_class=SiteSerializer, status=201, location=reverse("sites:site-detail", args=[site.pk]))

    def partial_update(self, request, *args, **kwargs):
        with translate_domain_errors(), hierarchy_write():
            site = self.lock(request, self.get_queryset(), SiteSerializer)
            serializer = self.get_serializer(site, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            site = serializer.save()
            return self.respond(site, serializer_class=SiteSerializer)

    def _lifecycle(self, request, status):
        with translate_domain_errors(), hierarchy_write():
            site = self.lock(request, self.get_queryset(), SiteSerializer)
            EmptyObjectSerializer(data=request.data).is_valid(raise_exception=True)
            site = transition_site(site.pk, status=status)
            return self.respond(site, serializer_class=SiteSerializer)

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._lifecycle(request, Site.Status.ACTIVE)

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteSerializer)
    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        return self._lifecycle(request, Site.Status.SUSPENDED)

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        return self._lifecycle(request, Site.Status.ARCHIVED)

    @extend_schema(parameters=[IF_MATCH], responses=SiteSerializer, description="Merge an allowlisted configuration change into this Site only.")
    @action(detail=True, methods=["patch"])
    def configuration(self, request, pk=None):
        with translate_domain_errors(), hierarchy_write():
            site = self.lock(request, self.get_queryset(), SiteSerializer)
            site = apply_site_configuration(site.pk, request.data)
            return self.respond(site, serializer_class=SiteSerializer)


@extend_schema(tags=["Domains"])
@extend_schema_view(
    list=extend_schema(parameters=[OpenApiParameter("hostname", str), OpenApiParameter("status", str, enum=SiteDomain.Status.values), OpenApiParameter("is_primary", bool), OpenApiParameter("ordering", str), OpenApiParameter("page", int)], description="Domains for this Site only."),
    retrieve=extend_schema(description="404 when the domain belongs to another Site."),
    create=extend_schema(description="Development admin only. Hostname is normalized and globally unique."),
    partial_update=extend_schema(parameters=[IF_MATCH], description="Hostname and primary designation are not edited here."),
)
class SiteDomainViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AdministrationViewSet):
    queryset = SiteDomain.objects.select_related("site").order_by("hostname")
    serializer_class = SiteDomainSerializer
    permission_by_action = {
        "list": "sites.view", "retrieve": "sites.view", "create": "sites.update",
        "partial_update": "sites.update", "activate": "sites.update", "deactivate": "sites.update",
        "set_primary": "sites.update",
    }

    def get_queryset(self):
        queryset = super().get_queryset()
        site_pk = self.kwargs.get("site_pk")
        if site_pk is not None:
            return queryset.filter(site_id=site_pk)
        code = self.permission_by_action.get(self.action, "sites.view")
        allowed = authorized_site_ids(self.request.user, code)
        if allowed is None:
            return queryset
        org_ids = authorized_organization_ids(self.request.user, code) or []
        return queryset.filter(Q(site_id__in=allowed) | Q(site__organization_unit_id__in=org_ids))

    def get_serializer_class(self):
        return SiteDomainUpdateSerializer if self.action == "partial_update" else SiteDomainSerializer

    def list(self, request, *args, **kwargs):
        get_object_or_404(Site, pk=self.kwargs["site_pk"])
        return _list(self, DomainQuerySerializer, (("hostname", "status", "is_primary"), (("hostname", "hostname"), ("status", "status"), ("is_primary", "is_primary"))), "hostname")

    def retrieve(self, request, *args, **kwargs):
        return self.respond(self.get_object(), serializer_class=SiteDomainSerializer)

    def create(self, request, *args, **kwargs):
        reject_idempotency(request)
        site = get_object_or_404(Site, pk=self.kwargs["site_pk"])
        with translate_domain_errors(), domain_write():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            domain = serializer.save(site=site)
        return self.respond(domain, serializer_class=SiteDomainSerializer, status=201, location=reverse("sites:sitedomain-detail", args=[site.pk, domain.pk]))

    def partial_update(self, request, *args, **kwargs):
        with translate_domain_errors(), domain_write():
            domain = self.lock(request, self.get_queryset(), SiteDomainSerializer)
            serializer = self.get_serializer(domain, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            return self.respond(serializer.save(), serializer_class=SiteDomainSerializer)

    def _status(self, request, command):
        with translate_domain_errors(), domain_write():
            domain = self.lock(request, self.get_queryset(), SiteDomainSerializer)
            EmptyObjectSerializer(data=request.data).is_valid(raise_exception=True)
            return self.respond(command(domain.pk), serializer_class=SiteDomainSerializer)

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteDomainSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None, site_pk=None):
        return self._status(request, activate_domain)

    @extend_schema(parameters=[IF_MATCH], request=DomainDeactivateSerializer, responses=SiteDomainSerializer, description="Deactivating the active primary requires replacement, the id of another active domain on this Site. Both changes commit together.")
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None, site_pk=None):
        with translate_domain_errors(), domain_write():
            domain = self.lock(request, self.get_queryset(), SiteDomainSerializer)
            payload = DomainDeactivateSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            return self.respond(
                deactivate_domain(domain.pk, replacement_id=payload.validated_data.get("replacement")),
                serializer_class=SiteDomainSerializer,
            )

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteDomainSerializer, description="Atomically leaves exactly one primary domain for this Site.")
    @action(detail=True, methods=["post"], url_path="set-primary")
    def set_primary(self, request, pk=None, site_pk=None):
        with translate_domain_errors(), domain_write():
            domain = self.lock(request, self.get_queryset(), SiteDomainSerializer)
            EmptyObjectSerializer(data=request.data).is_valid(raise_exception=True)
            return self.respond(designate_primary(domain.pk), serializer_class=SiteDomainSerializer)


@extend_schema(tags=["Sites"])
@extend_schema_view(
    list=extend_schema(parameters=[OpenApiParameter("module", int), OpenApiParameter("is_enabled", bool), OpenApiParameter("ordering", str, description="module_id, optionally prefixed with '-'."), OpenApiParameter("page", int)], description="Enablement rows for this Site only."),
    retrieve=extend_schema(description="404 when the assignment belongs to another Site."),
    create=extend_schema(description="Enable one shipped, globally enabled module for this Site. A duplicate pair returns 409."),
    partial_update=extend_schema(parameters=[IF_MATCH], description="Replace this Site's module settings. Enabling uses the enable action."),
)
class SiteModuleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AdministrationViewSet):
    queryset = SiteModule.objects.select_related("site", "module").order_by("module_id")
    serializer_class = SiteModuleSerializer
    permission_by_action = {
        "list": "sites.view", "retrieve": "sites.view", "create": "sites.update",
        "partial_update": "sites.update", "enable": "sites.update", "disable": "sites.update",
    }

    def get_queryset(self):
        queryset = super().get_queryset()
        site_pk = self.kwargs.get("site_pk")
        if site_pk is not None:
            return queryset.filter(site_id=site_pk)
        code = self.permission_by_action.get(self.action, "sites.view")
        allowed = authorized_site_ids(self.request.user, code)
        if allowed is None:
            return queryset
        org_ids = authorized_organization_ids(self.request.user, code) or []
        return queryset.filter(Q(site_id__in=allowed) | Q(site__organization_unit_id__in=org_ids))

    def list(self, request, *args, **kwargs):
        get_object_or_404(Site, pk=self.kwargs["site_pk"])
        return _list(self, SiteModuleQuerySerializer, (("module_id",), (("module", "module_id"), ("is_enabled", "is_enabled"))), "module_id")

    def retrieve(self, request, *args, **kwargs):
        return self.respond(self.get_object(), serializer_class=SiteModuleSerializer)

    def create(self, request, *args, **kwargs):
        reject_idempotency(request)
        site = get_object_or_404(Site, pk=self.kwargs["site_pk"])
        with translate_domain_errors():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            module = serializer.validated_data["module"]
            if SiteModule.objects.filter(site=site, module=module).exists():
                raise Conflict({"module": ["This Site already has this module."]})
            # Enabling validates the shipped/global capability in the service.
            # A per-Site enabled check here would prevent first-time enablement.
            enablement = enable_module_for_site(site.pk, module.pk, configuration=serializer.validated_data.get("configuration"))
        return self.respond(enablement, serializer_class=SiteModuleSerializer, status=201, location=reverse("sites:sitemodule-detail", args=[site.pk, enablement.pk]))

    def partial_update(self, request, *args, **kwargs):
        with translate_domain_errors():
            enablement = self.lock(request, self.get_queryset(), SiteModuleSerializer)
            serializer = self.get_serializer(enablement, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            return self.respond(serializer.save(), serializer_class=SiteModuleSerializer)

    def _switch(self, request, command):
        with translate_domain_errors():
            enablement = self.lock(request, self.get_queryset(), SiteModuleSerializer)
            EmptyObjectSerializer(data=request.data).is_valid(raise_exception=True)
            return self.respond(command(enablement.site_id, enablement.module_id), serializer_class=SiteModuleSerializer)

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteModuleSerializer)
    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None, site_pk=None):
        return self._switch(request, enable_module_for_site)

    @extend_schema(parameters=[IF_MATCH], request=EMPTY, responses=SiteModuleSerializer, description="Turns the module off for this Site and keeps its configuration.")
    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None, site_pk=None):
        return self._switch(request, disable_module_for_site)


@extend_schema(tags=["Site templates"])
@extend_schema_view(
    list=extend_schema(parameters=[*LIST_PARAMETERS, OpenApiParameter("status", str, enum=SiteTemplate.Status.values)], description="Platform-admin only."),
    retrieve=extend_schema(description="Platform-admin only."),
    create=extend_schema(description="Development admin only. New templates start INACTIVE unless status is supplied."),
    partial_update=extend_schema(parameters=[IF_MATCH], description="Development admin only. Code is immutable. Existing Sites are not rewritten."),
)
class SiteTemplateViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AdministrationViewSet):
    queryset = SiteTemplate.objects.order_by("code")
    serializer_class = SiteTemplateSerializer
    permission_by_action = {
        "list": "platform.sites.manage_registry", "retrieve": "platform.sites.manage_registry",
        "create": "platform.sites.manage_registry", "partial_update": "platform.sites.manage_registry",
    }

    def get_serializer_class(self):
        return SiteTemplateUpdateSerializer if self.action == "partial_update" else SiteTemplateSerializer

    def list(self, request, *args, **kwargs):
        return _list(self, TemplateQuerySerializer, (("code", "name", "status", "created_at", "updated_at"), (("code", "code"), ("status", "status"))), "code")

    def retrieve(self, request, *args, **kwargs):
        return self.respond(self.get_object(), serializer_class=SiteTemplateSerializer)

    def create(self, request, *args, **kwargs):
        reject_idempotency(request)
        with translate_domain_errors():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            template = serializer.save()
        return self.respond(template, serializer_class=SiteTemplateSerializer, status=201, location=reverse("site_templates:sitetemplate-detail", args=[template.pk]))

    def partial_update(self, request, *args, **kwargs):
        with translate_domain_errors():
            template = self.lock(request, self.get_queryset(), SiteTemplateSerializer)
            serializer = self.get_serializer(template, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            return self.respond(serializer.save(), serializer_class=SiteTemplateSerializer)


@extend_schema(tags=["Modules"])
@extend_schema_view(
    list=extend_schema(parameters=[*LIST_PARAMETERS, OpenApiParameter("status", str, enum=Module.Status.values), OpenApiParameter("is_enabled", bool)], description="Platform-admin only. Planned modules are listed and are not usable."),
    retrieve=extend_schema(description="Platform-admin only."),
    create=extend_schema(description="Development admin only. Registers a capability. It does not implement one."),
    partial_update=extend_schema(parameters=[IF_MATCH], description="Development admin only. A planned module cannot be marked implemented or globally enabled."),
)
class ModuleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AdministrationViewSet):
    queryset = Module.objects.order_by("code")
    serializer_class = ModuleSerializer
    permission_by_action = {
        "list": "platform.sites.manage_registry", "retrieve": "platform.sites.manage_registry",
        "create": "platform.sites.manage_registry", "partial_update": "platform.sites.manage_registry",
    }

    def get_serializer_class(self):
        return ModuleUpdateSerializer if self.action == "partial_update" else ModuleSerializer

    def list(self, request, *args, **kwargs):
        return _list(self, ModuleQuerySerializer, (("code", "name", "status", "created_at", "updated_at"), (("code", "code"), ("status", "status"), ("is_enabled", "is_enabled"))), "code")

    def retrieve(self, request, *args, **kwargs):
        return self.respond(self.get_object(), serializer_class=ModuleSerializer)

    def create(self, request, *args, **kwargs):
        reject_idempotency(request)
        with translate_domain_errors():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            module = serializer.save()
        return self.respond(module, serializer_class=ModuleSerializer, status=201, location=reverse("platform_modules:module-detail", args=[module.pk]))

    def partial_update(self, request, *args, **kwargs):
        with translate_domain_errors():
            module = self.lock(request, self.get_queryset(), ModuleSerializer)
            serializer = self.get_serializer(module, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            return self.respond(serializer.save(), serializer_class=ModuleSerializer)
