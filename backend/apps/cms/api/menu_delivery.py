"""Public effective menus, and the Site policy that selects their sources."""
from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.generics import GenericAPIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site
from apps.sites.selectors.modules import module_available_on_request

from ..menu_cache import delivery_version
from ..menu_models import LOCAL_PRECEDENCE, MENU_LOCATIONS, MenuInheritance
from ..selectors.menu_delivery import compose_location
from ..services import menu_delivery as domain
from ..services.menus import authorize_menu
from ..services.publication_cache import get_public_cache, set_public_cache
from .menus import menu_errors


class PublicMenuNodeSerializer(serializers.Serializer):
    label = serializers.CharField()
    href = serializers.CharField()
    source = serializers.ChoiceField(choices=("global", "inherited", "local"))
    children = serializers.ListField(child=serializers.JSONField())


class PublicMenusSerializer(serializers.Serializer):
    site = serializers.IntegerField()
    locations = serializers.DictField(child=serializers.ListField(child=PublicMenuNodeSerializer()))


class PublicMenuQuery(StrictFields, serializers.Serializer):
    location = serializers.ChoiceField(choices=MENU_LOCATIONS, required=False)


class PublicMenusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        operation_id="public_site_menus",
        tags=["Public menus"],
        parameters=[OpenApiParameter("location", str, enum=list(MENU_LOCATIONS), description="One configured location. Omit to return every location.")],
        responses=PublicMenusSerializer,
        description=(
            "Effective header, footer and other menus for the Site resolved from "
            "the trusted Host. Global fragments, an explicit parent Site's local "
            "menu, and the local menu follow the Site's delivery policy. Draft "
            "items, unpublished targets and other Sites' menus are omitted. "
            "Query parameters cannot select a Site."
        ),
    )
    def get(self, request):
        site = getattr(request, "site", None)
        if site is None or not module_available_on_request(request, "MENUS"):
            raise NotFound("The requested menu was not found.")
        if any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise serializers.ValidationError({"query": "Supply each parameter only once."})
        query = PublicMenuQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        locations = (query.validated_data["location"],) if "location" in query.validated_data else MENU_LOCATIONS
        payload = {location: _cached_location(site.pk, location) for location in locations}
        response = Response({"site": site.pk, "locations": payload})
        response["Cache-Control"] = "public, max-age=0, must-revalidate"
        response["Vary"] = "Host"
        return response


def _cached_location(site_id, location):
    version = delivery_version(site_id, location)
    key = f"menu:{location}:delivery:{version}"
    cached = get_public_cache(site_id, key)
    if cached is None:
        cached = compose_location(site_id, location)
        set_public_cache(site_id, key, cached)
    return cached


class InheritanceOutput(serializers.ModelSerializer):
    class Meta:
        model = MenuInheritance
        fields = ("id", "site", "location", "inherit_from", "include_global", "local_precedence", "created_at", "updated_at")
        read_only_fields = fields


class InheritanceInput(StrictFields, serializers.Serializer):
    inherit_from = serializers.IntegerField(allow_null=True, min_value=1)
    include_global = serializers.BooleanField()
    local_precedence = serializers.ChoiceField(choices=LOCAL_PRECEDENCE)


class MenuInheritanceListView(GenericAPIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = InheritanceOutput
    queryset = MenuInheritance.objects.none()
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        tags=["Menus"],
        parameters=[OpenApiParameter("site_pk", int, OpenApiParameter.PATH)],
        responses=InheritanceOutput(many=True),
        description="menu.read. Lists this Site's explicit inheritance policies and does not include parent-menu management.",
    )
    def get(self, request, site_pk):
        with menu_errors():
            site = _authorized_site(request, site_pk, edit=False)
            return Response(InheritanceOutput(domain.inheritance_policies(site.pk), many=True).data)


class MenuInheritanceDetailView(GenericAPIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = InheritanceOutput
    queryset = MenuInheritance.objects.none()
    http_method_names = ["get", "put", "head", "options"]

    @extend_schema(
        tags=["Menus"],
        parameters=[
            OpenApiParameter("site_pk", int, OpenApiParameter.PATH),
            OpenApiParameter("location", str, OpenApiParameter.PATH, enum=list(MENU_LOCATIONS)),
        ],
        request=InheritanceInput,
        responses=InheritanceOutput,
        description=(
            "menu.write replaces this Site's delivery policy for one location. "
            "inherit_from does not grant menu.write on that Site. Loops return "
            "400 inheritance_loop. The MENUS module must be enabled."
        ),
    )
    def get(self, request, site_pk, location):
        with menu_errors():
            site = _authorized_site(request, site_pk, edit=False)
            policy = get_object_or_404(MenuInheritance, site=site, location=location)
            return Response(InheritanceOutput(policy).data)

    @extend_schema(request=InheritanceInput, responses=InheritanceOutput)
    def put(self, request, site_pk, location):
        if location not in MENU_LOCATIONS:
            raise NotFound("The requested menu was not found.")
        with menu_errors():
            site = _authorized_site(request, site_pk, edit=True)
            payload = InheritanceInput(data=request.data)
            payload.is_valid(raise_exception=True)
            try:
                policy = domain.set_menu_inheritance(
                    site.pk, actor=request.user, location=location, **{
                        "inherit_from_id": payload.validated_data["inherit_from"],
                        "include_global": payload.validated_data["include_global"],
                        "local_precedence": payload.validated_data["local_precedence"],
                    },
                )
            except DomainValidationError as exc:
                text = str(exc).lower()
                reason = "inheritance_loop" if "loop" in text or "own menu" in text else "invalid_menu"
                fields = getattr(exc, "message_dict", {"non_field_errors": exc.messages})
                raise serializers.ValidationError({"reason": reason, "fields": fields}) from exc
            return Response(InheritanceOutput(policy).data)


def _authorized_site(request, site_pk, *, edit):
    site = get_object_or_404(Site, pk=site_pk)
    try:
        authorize_menu(request.user, site.pk, edit=edit, permission="menu.write" if edit else "menu.read")
    except PermissionDenied as exc:
        from rest_framework.exceptions import PermissionDenied as ApiDenied
        raise ApiDenied(str(exc)) from exc
    return site
