"""Conditional Site-scoped sidebar lifecycle API."""
from contextlib import contextmanager
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, extend_schema_field, OpenApiParameter
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet
from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.access import Conflict, PreconditionRequired
from apps.sites.api.serializers import StrictFields
from ..models import ContentEditConflict
from ..sidebar_models import Sidebar
from ..services import sidebars as domain
from .pages import SitePagePagination, SITE_PARAMETER


class SidebarComponentInput(StrictFields, serializers.Serializer):
    id = serializers.RegexField(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$", help_text="Stable component identity; unique within this sidebar.")
    type = serializers.ChoiceField(choices=['menu'])
    menu_id = serializers.UUIDField(help_text="Active local Menu owned by the same Site. A Menu may appear once.")


class SidebarInput(StrictFields, serializers.Serializer):
    name = serializers.CharField(max_length=120)
    components = serializers.ListField(child=SidebarComponentInput(), min_length=1, max_length=12)
    status = serializers.ChoiceField(choices=['ACTIVE', 'ARCHIVED'], required=False)


class SidebarOutput(serializers.ModelSerializer):
    components = SidebarComponentInput(many=True, read_only=True)
    snapshot = serializers.SerializerMethodField()

    @extend_schema_field(serializers.JSONField())
    def get_snapshot(self, row):
        try:
            return domain.freeze(row, site_id=row.site_id)
        except DomainValidationError:
            return {}

    class Meta:
        model = Sidebar
        fields = ('id', 'site', 'name', 'status', 'components', 'snapshot', 'version', 'created_by', 'updated_by', 'created_at', 'updated_at')
        read_only_fields = fields


@contextmanager
def sidebar_errors():
    try:
        yield
    except DomainValidationError as error:
        raise serializers.ValidationError(error.message_dict) from error
    except (ContentEditConflict, IntegrityError) as error:
        raise Conflict('Sidebar changed or its name is already used. Reload and retry.') from error


def etag(row):
    return f'"sidebar-{row.pk}-v{row.version}"'


class SidebarViewSet(GenericViewSet):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = SidebarOutput
    queryset = Sidebar.objects.none()
    lookup_value_regex = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    pagination_class = SitePagePagination
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        with sidebar_errors():
            domain.authorize(request.user, self.kwargs['site_pk'], edit=request.method not in ('GET', 'HEAD', 'OPTIONS'))

    def get_queryset(self):
        return Sidebar.objects.filter(site_id=self.kwargs['site_pk']).order_by('name', 'id')

    def _row(self):
        return get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])

    def _expected(self, row):
        supplied = self.request.headers.get('If-Match')
        if not supplied:
            raise PreconditionRequired()
        if supplied != etag(row):
            raise Conflict('Sidebar changed. Reload and retry.')
        return row.version

    def _response(self, row, status=200):
        return Response(SidebarOutput(row).data, status=status, headers={'ETag': etag(row), 'Cache-Control': 'private, no-store', 'Vary': 'Authorization, Cookie, Host'})

    @extend_schema(tags=['CMS sidebars'], parameters=[SITE_PARAMETER], responses=SidebarOutput(many=True), description='List Site-owned reusable sidebar definitions; PAGES and a canonical CMS membership required. Deterministic name/ID pagination, default 20/max 100.')
    def list(self, request, *args, **kwargs):
        if set(request.query_params) - {'page', 'page_size'}:
            raise serializers.ValidationError({'query': 'Unsupported query parameter.'})
        rows = self.paginate_queryset(self.get_queryset())
        response = self.get_paginated_response(SidebarOutput(rows, many=True).data)
        response['Cache-Control'] = 'private, no-store'
        response['Vary'] = 'Authorization, Cookie, Host'
        return response

    @extend_schema(tags=['CMS sidebars'], parameters=[SITE_PARAMETER], responses=SidebarOutput)
    def retrieve(self, request, *args, **kwargs):
        return self._response(self._row())

    @extend_schema(tags=['CMS sidebars'], parameters=[SITE_PARAMETER], request=SidebarInput, responses={201: SidebarOutput}, description='Create a named Site-owned sidebar with 1–12 ordered Menu references. Component IDs and Menu IDs must be unique. Only active same-Site local Menus are accepted.')
    def create(self, request, *args, **kwargs):
        payload = SidebarInput(data=request.data)
        payload.is_valid(raise_exception=True)
        with sidebar_errors():
            row = domain.write(site_id=int(self.kwargs['site_pk']), actor=request.user, data=payload.validated_data)
        return self._response(row, 201)

    @extend_schema(tags=['CMS sidebars'], parameters=[SITE_PARAMETER, OpenApiParameter('If-Match', str, OpenApiParameter.HEADER, required=True)], request=SidebarInput, responses=SidebarOutput, description='Rename, reorder/replace components, or archive an unused sidebar. Current ETag required; stale writes return 409. Published Page snapshots remain unchanged.')
    def partial_update(self, request, *args, **kwargs):
        row = self._row()
        expected = self._expected(row)
        payload = SidebarInput(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        if not payload.validated_data:
            raise serializers.ValidationError({'non_field_errors': 'Provide a change.'})
        with sidebar_errors():
            row = domain.write(site_id=row.site_id, sidebar_id=row.pk, actor=request.user, data=payload.validated_data, expected=expected)
        return self._response(row)

    @extend_schema(tags=['CMS sidebars'], parameters=[SITE_PARAMETER, OpenApiParameter('If-Match', str, OpenApiParameter.HEADER, required=True)], responses={204: None}, description='Delete only an unassigned sidebar. All draft/live/archived Page assignments guard deletion; detach and publish replacements first.')
    def destroy(self, request, *args, **kwargs):
        row = self._row()
        expected = self._expected(row)
        with sidebar_errors():
            domain.remove(site_id=row.site_id, sidebar_id=row.pk, actor=request.user, expected=expected)
        return Response(status=204)
