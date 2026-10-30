"""Authenticated, Site-scoped Menu aggregate API with strong ETags."""
from contextlib import contextmanager
from uuid import UUID

from django.core.exceptions import ValidationError as DomainValidationError
from django.db import DatabaseError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiExample, OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.reverse import reverse
from rest_framework.viewsets import GenericViewSet

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.api.serializers import StrictFields
from apps.sites.api.access import reject_idempotency
from apps.sites.models import Site

from ..menu_models import MENU_LOCATIONS, Menu, MenuItem
from ..selectors.menus import menu_tree
from ..services import menus as domain


class MenuAPIConflict(APIException):
    status_code = 409


class MenuMissingVersion(APIException):
    status_code = 428
    default_detail = "Supply the owning Menu's current ETag in If-Match."


@contextmanager
def menu_errors():
    try:
        yield
    except domain.MenuPreconditionRequired as exc:
        raise MenuMissingVersion() from exc
    except domain.MenuConflict as exc:
        raise MenuAPIConflict({"reason": exc.reason}) from exc
    except DomainValidationError as exc:
        fields = getattr(exc, "message_dict", {"non_field_errors": exc.messages})
        reason = "invalid_tree" if "parent" in fields or "tree" in fields else (
            "invalid_target" if set(fields) & {"page", "post", "target", "item_type"} else (
                "module_disabled" if "module" in fields else "invalid_order" if "order" in fields else "invalid_menu"
            )
        )
        raise serializers.ValidationError({"reason": reason, "fields": fields}) from exc
    except DatabaseError as exc:
        cause = exc.__cause__
        constraint = getattr(getattr(cause, "diag", None), "constraint_name", "") or ""
        state = getattr(cause, "sqlstate", None)
        if constraint == "audit_write_failed":
            raise  # The shared handler returns a sanitized 503; transaction rolls back.
        conflicts = {
            "menu_site_location_uniq": "duplicate_location",
            "menu_global_location_uniq": "duplicate_location",
            "menu_item_sibling_order": "duplicate_order",
        }
        if constraint in conflicts or state in {"40001", "40P01"}:
            raise MenuAPIConflict({"reason": conflicts.get(constraint, "concurrent_write")}) from exc
        if state in {"23503", "23514"}:
            reason = "invalid_tree" if constraint in {"menu_parent_owner", "menu_acyclic", "menu_max_depth"} else (
                "module_disabled" if constraint == "menu_module_enabled" else "invalid_target"
            )
            raise serializers.ValidationError({"reason": reason}) from exc
        raise


class MenuOutput(serializers.ModelSerializer):
    class Meta:
        model = Menu
        fields = ("id", "site", "location", "name", "is_active", "is_global", "version", "created_at", "updated_at")
        read_only_fields = fields


class MenuInput(StrictFields, serializers.Serializer):
    name = serializers.CharField(max_length=255)
    location = serializers.ChoiceField(choices=MENU_LOCATIONS)
    is_global = serializers.BooleanField(required=False)

    def validate_location(self, value):
        return value.strip().lower()


class MenuPatch(MenuInput):
    name = serializers.CharField(max_length=255, required=False)
    location = serializers.ChoiceField(choices=MENU_LOCATIONS, required=False)


class ItemOutput(serializers.ModelSerializer):
    class Meta:
        model = MenuItem
        fields = ("id", "menu", "site", "label", "item_type", "page", "post", "target", "parent",
                  "sort_order", "is_active", "allow_cross_site", "created_at", "updated_at")
        read_only_fields = fields


class ItemInput(StrictFields, serializers.Serializer):
    label = serializers.CharField(max_length=255)
    item_type = serializers.ChoiceField(choices=MenuItem.ItemType.choices)
    page = serializers.UUIDField(required=False, allow_null=True)
    post = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    target = serializers.CharField(required=False, allow_blank=True, max_length=2048, trim_whitespace=False)
    parent = serializers.UUIDField(required=False, allow_null=True)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    is_active = serializers.BooleanField(required=False)
    allow_cross_site = serializers.BooleanField(required=False)


class ItemPatch(ItemInput):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ("parent", "sort_order"):
            self.fields.pop(name)
        for field in self.fields.values():
            field.required = False


class ReorderInput(StrictFields, serializers.Serializer):
    parent = serializers.UUIDField(allow_null=True)
    items = serializers.ListField(child=serializers.UUIDField(), max_length=1000, allow_empty=True)


class MoveInput(StrictFields, serializers.Serializer):
    parent = serializers.UUIDField(allow_null=True)
    position = serializers.IntegerField(min_value=0, max_value=1000)


class EmptyInput(StrictFields, serializers.Serializer):
    pass


class TreeOutput(serializers.Serializer):
    menu = MenuOutput()
    include_inactive = serializers.BooleanField()
    items = ItemOutput(many=True, help_text="Bounded preorder tree; each item's parent identifies its nesting.")


class TreeQuery(StrictFields, serializers.Serializer):
    include_inactive = serializers.BooleanField(required=False, default=True)


class ListQuery(StrictFields, serializers.Serializer):
    page = serializers.IntegerField(required=False, min_value=1)
    page_size = serializers.IntegerField(required=False, min_value=1, max_value=100)
    is_active = serializers.BooleanField(required=False)


class MenuPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


IF_MATCH = OpenApiParameter("If-Match", str, OpenApiParameter.HEADER, required=True,
    description='The current owning Menu ETag, e.g. "menu-<uuid>-v7". Every item edit invalidates it. Stale tokens return 409.')
SITE = OpenApiParameter("site_pk", int, OpenApiParameter.PATH, description="Owning Site; checked against application scope.")
MENU = OpenApiParameter("menu_pk", UUID, OpenApiParameter.PATH, description="Owning Menu UUID.")


class MenuAPIBase(GenericViewSet):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    lookup_value_regex = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    pagination_class = MenuPagination

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def _site(self):
        site = get_object_or_404(Site, pk=self.kwargs["site_pk"])
        permission = "menu.publish" if self.action in {"activate", "deactivate"} else (
            "menu.read" if self.request.method in {"GET", "HEAD", "OPTIONS"} else "menu.write"
        )
        domain.authorize_menu(self.request.user, site.pk, edit=permission == "menu.write", permission=permission)
        return site

    def _menu(self):
        site = self._site()
        pk = self.kwargs.get("menu_pk") or self.kwargs["pk"]
        return get_object_or_404(Menu, pk=pk, site_id=site.pk)

    def _input(self, cls):
        value = cls(data=self.request.data)
        try:
            value.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            keys = set(exc.detail) if isinstance(exc.detail, dict) else set()
            reason = "invalid_tree" if "parent" in keys else (
                "invalid_target" if keys & {"target", "page", "post", "item_type"} else (
                    "invalid_order" if keys & {"items", "position", "sort_order"} else None
                )
            )
            if reason:
                raise serializers.ValidationError({"reason": reason, "fields": exc.detail}) from exc
            raise
        return value.validated_data

    def _query(self, cls):
        if any(len(self.request.query_params.getlist(key)) != 1 for key in self.request.query_params):
            raise serializers.ValidationError({"query": "Supply each parameter only once."})
        value = cls(data=self.request.query_params)
        value.is_valid(raise_exception=True)
        return value.validated_data

    def _expected(self):
        return self.request.headers.get("If-Match")

    def _response(self, data, menu=None, *, status=200, location=None):
        headers = {}
        if menu is not None:
            menu.refresh_from_db()
            headers["ETag"] = domain.menu_etag(menu)
        if location:
            headers["Location"] = location
        return Response(data, status=status, headers=headers)

    def _tree(self, menu, include=True):
        nodes = menu_tree(menu.pk, actor=self.request.user, include_inactive=include)

        def flatten(branch):
            for node in branch:
                yield node["item"]
                yield from flatten(node["children"])

        return {"menu": MenuOutput(menu).data, "include_inactive": include, "items": ItemOutput(list(flatten(nodes)), many=True).data}


@extend_schema(tags=["Menus"], parameters=[SITE])
class MenuViewSet(MenuAPIBase):
    serializer_class = MenuOutput
    queryset = Menu.objects.none()

    @extend_schema(parameters=[ListQuery], responses=MenuOutput(many=True), description="menu.read; includes active and inactive menus. Ordered by location then UUID. Page size 20, maximum 100.")
    def list(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            site = self._site()
            query = self._query(ListQuery)
            rows = Menu.objects.filter(site=site).order_by("location", "id")
            if "is_active" in query:
                rows = rows.filter(is_active=query["is_active"])
            return self.get_paginated_response(MenuOutput(self.paginate_queryset(rows), many=True).data)

    @extend_schema(responses=MenuOutput, description="menu.read. ETag versions the entire Menu and all its items.")
    def retrieve(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            return self._response(MenuOutput(menu).data, menu)

    @extend_schema(request=MenuInput, responses={201: MenuOutput}, examples=[OpenApiExample("Draft header", value={"name": "Main navigation", "location": "header"}, request_only=True)],
        description="menu.write. Creates an inactive draft. Locations are unique per Site even when inactive; duplicates return 409 duplicate_location. No If-Match for creation.")
    def create(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            site = self._site()
            reject_idempotency(request)
            fields = self._input(MenuInput)
            fields.setdefault("is_global", False)
            menu = domain.create_menu(actor=request.user, site_id=site.pk, is_active=False, **fields)
            return self._response(MenuOutput(menu).data, menu, status=201,
                location=reverse("sites:menu-detail", kwargs={"site_pk": site.pk, "pk": menu.pk}))

    @extend_schema(parameters=[IF_MATCH], request=MenuPatch, responses=MenuOutput, description="menu.write; active menus also require menu.publish. Scope, activation and version cannot be patched.")
    def partial_update(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            menu = domain.update_menu(menu.pk, actor=request.user, expected=self._expected(), **self._input(MenuPatch))
            return self._response(MenuOutput(menu).data, menu)

    @extend_schema(parameters=[IF_MATCH], responses={204: None}, description="menu.write; active menus also require menu.publish. Only empty menus can be deleted; otherwise 409 children_present. Deactivation retains records.")
    def destroy(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            domain.delete_menu_record(menu.pk, actor=request.user, expected=self._expected())
            return self._response(None, status=204)

    @extend_schema(parameters=[TreeQuery], responses=TreeOutput, description="menu.read. One bounded preorder tree response, maximum 1000 items. Inactive items included by default for editing; false hides inactive branches and inactive menus.")
    @action(detail=True, methods=["get"])
    def tree(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            query = self._query(TreeQuery)
            return self._response(self._tree(menu, query["include_inactive"]), menu)

    @extend_schema(parameters=[IF_MATCH], request=ReorderInput, responses=TreeOutput, description="menu.write (plus menu.publish for an active menu). Atomic sibling reorder: supply every sibling UUID exactly once; parent=null selects roots. Missing, duplicate or foreign IDs return invalid_order; stale If-Match returns 409 version_conflict.")
    @action(detail=True, methods=["post"])
    def reorder(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            body = self._input(ReorderInput)
            menu = domain.reorder_menu(menu.pk, actor=request.user, expected=self._expected(), parent_id=body["parent"], item_ids=body["items"])
            return self._response(self._tree(menu), menu)

    def _activate(self, request, active):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            self._input(EmptyInput)
            menu = domain.set_menu_active(menu.pk, actor=request.user, expected=self._expected(), active=active)
            return self._response(MenuOutput(menu).data, menu)

    @extend_schema(parameters=[IF_MATCH], request=EmptyInput, responses=MenuOutput, description="menu.publish. Activate the Menu; this does not publish linked Pages or Posts.")
    @action(detail=True, methods=["post"])
    def activate(self, request, *args, **kwargs):
        return self._activate(request, True)

    @extend_schema(parameters=[IF_MATCH], request=EmptyInput, responses=MenuOutput, description="menu.publish. Deactivate the Menu and retain every item.")
    @action(detail=True, methods=["post"])
    def deactivate(self, request, *args, **kwargs):
        return self._activate(request, False)


@extend_schema(tags=["Menus"], parameters=[SITE, MENU])
class MenuItemViewSet(MenuAPIBase):
    serializer_class = ItemOutput
    queryset = MenuItem.objects.none()

    def _item(self, menu):
        return get_object_or_404(MenuItem, pk=self.kwargs["pk"], menu=menu, site_id=menu.site_id)

    @staticmethod
    def _fields(body):
        return {key + "_id" if key in {"page", "post", "parent"} else key: value for key, value in body.items()}

    @extend_schema(parameters=[ListQuery], responses=ItemOutput(many=True), description="menu.read. Paginated flat item inventory in sort_order/UUID order. The owning Menu ETag versions every item.")
    def list(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            query = self._query(ListQuery)
            rows = menu.items.order_by("sort_order", "id")
            if "is_active" in query:
                rows = rows.filter(is_active=query["is_active"])
            response = self.get_paginated_response(ItemOutput(self.paginate_queryset(rows), many=True).data)
            response["ETag"] = domain.menu_etag(menu)
            return response

    @extend_schema(responses=ItemOutput)
    def retrieve(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            return self._response(ItemOutput(self._item(menu)).data, menu)

    @extend_schema(parameters=[IF_MATCH], request=ItemInput, responses={201: ItemOutput}, description="menu.write (plus menu.publish for active menus). Site/menu identity derives from the URL. Missing sort_order appends to siblings. Internal foreign targets require explicit opt-in and target-Site content-view permission.")
    def create(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            reject_idempotency(request)
            item = domain.create_menu_item(menu.pk, actor=request.user, expected=self._expected(), **self._fields(self._input(ItemInput)))
            return self._response(ItemOutput(item).data, menu, status=201,
                location=reverse("sites:menu-item-detail", kwargs={"site_pk": menu.site_id, "menu_pk": menu.pk, "pk": item.pk}))

    @extend_schema(parameters=[IF_MATCH], request=ItemPatch, responses=ItemOutput, description="menu.write (plus menu.publish for active menus). Use move/reorder for parent and sibling positions. Unsafe targets return invalid_target.")
    def partial_update(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            item = self._item(menu)
            item = domain.update_menu_item(item.pk, actor=request.user, expected=self._expected(), **self._fields(self._input(ItemPatch)))
            return self._response(ItemOutput(item).data, menu)

    @extend_schema(parameters=[IF_MATCH], responses={204: None}, description="menu.write (plus menu.publish for active menus). Delete a leaf only; a non-leaf returns 409 children_present. Response ETag is the new owning Menu token.")
    def destroy(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            item = self._item(menu)
            domain.delete_menu_record(item.pk, actor=request.user, expected=self._expected(), item=True)
            return self._response(None, menu, status=204)

    @extend_schema(parameters=[IF_MATCH], request=MoveInput, responses=ItemOutput, description="menu.write (plus menu.publish for active menus). Atomic subtree move; position is the zero-based destination sibling index. Cycles and excessive descendant depth return invalid_tree and roll back every changed position.")
    @action(detail=True, methods=["post"])
    def move(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            item = self._item(menu)
            body = self._input(MoveInput)
            item = domain.move_menu_item(item.pk, actor=request.user, expected=self._expected(), parent_id=body["parent"], position=body["position"])
            return self._response(ItemOutput(item).data, menu)
