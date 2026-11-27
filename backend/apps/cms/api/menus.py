"""Authenticated, Site-scoped Menu aggregate API with strong ETags."""
from contextlib import contextmanager
from uuid import UUID

from django.core.exceptions import ValidationError as DomainValidationError
from django.db import DatabaseError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import inline_serializer, OpenApiExample, OpenApiParameter, extend_schema
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
    from django.db.models.deletion import ProtectedError

    try:
        yield
    except domain.MenuPreconditionRequired as exc:
        raise MenuMissingVersion() from exc
    except domain.MenuConflict as exc:
        raise MenuAPIConflict({"reason": exc.reason}) from exc
    except ProtectedError as exc:
        raise MenuAPIConflict({"reason": "menu_assigned"}) from exc
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
        detail = (
            getattr(getattr(cause, "diag", None), "message_primary", None)
            or str(cause or exc)
        ).lower()
        if constraint == "audit_write_failed":
            raise  # The shared handler returns a sanitized 503; transaction rolls back.
        conflicts = {
            "menu_site_location_uniq": "duplicate_location",
            "menu_site_code_unique": "duplicate_code",
            "menu_global_location_uniq": "duplicate_location",
            "menu_item_sibling_order": "duplicate_order",
        }
        if constraint in conflicts or state in {"40001", "40P01"}:
            raise MenuAPIConflict({"reason": conflicts.get(constraint, "concurrent_write")}) from exc
        if (
            "footer column" in detail
            or "menulocationassignment" in constraint
            or "menulocationassignment" in detail
        ):
            raise MenuAPIConflict({"reason": "menu_assigned"}) from exc
        if state in {"23503", "23514"}:
            reason = "invalid_tree" if constraint in {"menu_parent_owner", "menu_acyclic", "menu_max_depth"} else (
                "module_disabled" if constraint == "menu_module_enabled" else "invalid_target"
            )
            raise serializers.ValidationError({"reason": reason}) from exc
        raise


class NavigationPreviewOutput(serializers.Serializer):
    theme = serializers.ChoiceField(choices=("institutional","high-contrast"))
    site = serializers.IntegerField()
    name = serializers.CharField()
    public_origin = serializers.URLField(allow_null=True)
    preview = serializers.BooleanField()
    locations = serializers.DictField(child=serializers.ListField(child=serializers.JSONField()))
    menu_version = serializers.IntegerField(required=False)

class LocationInput(StrictFields, serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    menu = serializers.UUIDField(allow_null=True, required=False)
    menus = serializers.ListField(child=serializers.UUIDField(), max_length=4, required=False)

    def validate(self, attrs):
        if ('menu' in attrs) == ('menus' in attrs):
            raise serializers.ValidationError({'menus':'Supply either menu or menus, not both.'})
        return attrs
    replace = serializers.BooleanField(default=False)

class LocationPublishInput(StrictFields, serializers.Serializer):
    version = serializers.IntegerField(min_value=0)

class LocationOutput(serializers.Serializer):
    location = serializers.CharField()
    label = serializers.CharField()
    version = serializers.IntegerField()
    draft_menu = serializers.UUIDField(allow_null=True)
    published_menu = serializers.UUIDField(allow_null=True)
    draft_menus = serializers.ListField(child=serializers.UUIDField())
    published_menus = serializers.ListField(child=serializers.UUIDField())
    is_published = serializers.BooleanField()
    has_changes = serializers.BooleanField()

class MenuOutput(serializers.ModelSerializer):
    has_unpublished_changes = serializers.SerializerMethodField()

    def get_has_unpublished_changes(self, menu) -> bool:
        from ..menu_destinations import snapshot_items
        # None means a trusted live projection (including an empty menu): nothing
        # is staged until the first freeze or activate writes published_items.
        if menu.published_items is None:
            return False
        return menu.published_items != snapshot_items(menu)

    class Meta:
        model = Menu
        fields = ("id", "site", "code", "location", "name", "is_active", "is_global", "version", "has_unpublished_changes", "created_at", "updated_at")
        read_only_fields = fields


class MenuInput(StrictFields, serializers.Serializer):
    name = serializers.CharField(max_length=255)
    code = serializers.RegexField(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64, required=False)
    location = serializers.ChoiceField(choices=("", *MENU_LOCATIONS), required=False, default="")
    is_global = serializers.BooleanField(required=False)

    def validate_location(self, value):
        return value.strip().lower()


class MenuPatch(StrictFields, serializers.Serializer):
    is_global = serializers.BooleanField(required=False)
    name = serializers.CharField(max_length=255, required=False)
    location = serializers.ChoiceField(choices=("", *MENU_LOCATIONS), required=False)


class ItemOutput(serializers.ModelSerializer):
    destination_status = serializers.SerializerMethodField()

    def get_destination_status(self, item) -> str:
        from ..menu_destinations import destination_state
        return destination_state(item)

    class Meta:
        model = MenuItem
        fields = ("id", "menu", "site", "label", "item_type", "page", "post", "target", "parent",
                  "sort_order", "is_active", "category", "destination_status", "created_at", "updated_at")
        read_only_fields = fields


class ItemInput(StrictFields, serializers.Serializer):
    label = serializers.CharField(max_length=255)
    item_type = serializers.ChoiceField(choices=MenuItem.ItemType.choices)
    page = serializers.UUIDField(required=False, allow_null=True)
    post = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.UUIDField(required=False, allow_null=True)
    target = serializers.CharField(required=False, allow_blank=True, max_length=2048, trim_whitespace=False)
    parent = serializers.UUIDField(required=False, allow_null=True)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    is_active = serializers.BooleanField(required=False)


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
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    is_active = serializers.BooleanField(required=False,
        help_text="Optional active-state filter. Omit to include both active and inactive records.")


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
        permission = "menu.publish" if self.action in {"activate", "deactivate", "location_publish"} else (
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
        # QueryDict is treated as HTML form input by DRF: an omitted checkbox
        # becomes False. These are optional API filters, so preserve omission.
        value = cls(data=self.request.query_params.dict())
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

    def _preview_response(self,menu=None):
        from ..services.menu_preview import preview_navigation
        with menu_errors(),hierarchy_write():
            site=self._site()
            self._query(EmptyInput)
            data=preview_navigation(site,actor=self.request.user,menu=menu)
            response=Response(data)
            response['Vary']='Authorization, Cookie'
            response['X-Robots-Tag']='noindex, nofollow'
            response['Pragma']='no-cache'
            return response

    @extend_schema(responses=NavigationPreviewOutput,description="menu.write and MENUS required. Private, no-store preview of saved draft assignments and local working item trees. Public navigation is not changed; foreign/global fragments retain their published projection.")
    @action(detail=False,methods=["get"],url_path="preview-navigation",pagination_class=None)
    def preview_navigation(self,request,*args,**kwargs):
        return self._preview_response()

    @extend_schema(responses=NavigationPreviewOutput,description="Authorized same-Site working menu preview, including inactive menus. Unavailable targets are unlinked warnings. No shared cache or publication side effects.")
    @action(detail=True,methods=["get"],url_path="preview",pagination_class=None)
    def preview(self,request,*args,**kwargs):
        with menu_errors(),hierarchy_write():
            return self._preview_response(self._menu())

    @extend_schema(responses=LocationOutput(many=True),description="Supported active-template slots and current draft/public assignments; version 0 denotes legacy fallback without an explicit mapping.")
    @action(detail=False,methods=["get"],pagination_class=None)
    def locations(self,request,*args,**kwargs):
        from ..services.menu_locations import location_state
        with menu_errors(),hierarchy_write():
            return Response(location_state(self._site()))

    @extend_schema(parameters=[OpenApiParameter("location",str,OpenApiParameter.PATH,enum=["header","secondary","footer","sidebar"])],request=LocationInput,responses=LocationOutput,description="menu.write. Save a Site-local assignment draft. version is required; occupied-slot changes require replace=true. menu=null saves an explicit unassignment draft. Footer alternatively accepts ordered menus (0-4 distinct same-Site IDs), one equal-width column per menu.")
    @action(detail=False,methods=["post"],url_path=r"locations/(?P<location>[a-z-]+)/draft")
    def location_draft(self,request,*args,**kwargs):
        from ..services.menu_locations import write_location
        with menu_errors(),hierarchy_write():
            site=self._site();body=self._input(LocationInput)
            return Response(write_location(site.pk,kwargs['location'],actor=request.user,expected=body['version'],menu_id=body.get('menu'),menu_ids=body.get('menus'),replace=body['replace']))

    @extend_schema(parameters=[OpenApiParameter("location",str,OpenApiParameter.PATH,enum=["header","secondary","footer","sidebar"])],request=LocationPublishInput,responses=LocationOutput,description="menu.publish. Atomically promote the slot draft; selected menus must already be published. Null promotion suppresses legacy fallback without deleting menus. Stale versions return 409.")
    @action(detail=False,methods=["post"],url_path=r"locations/(?P<location>[a-z-]+)/publish")
    def location_publish(self,request,*args,**kwargs):
        from ..services.menu_locations import write_location
        with menu_errors(),hierarchy_write():
            site=self._site();body=self._input(LocationPublishInput)
            return Response(write_location(site.pk,kwargs['location'],actor=request.user,expected=body['version'],publish=True))

    @extend_schema(responses=inline_serializer(name="MenuDestinationOptions", fields={
        "pages": serializers.ListField(child=serializers.DictField()),
        "posts": serializers.ListField(child=serializers.DictField()),
        "categories": serializers.ListField(child=serializers.DictField()),
        "pagesAvailable": serializers.BooleanField(), "postsAvailable": serializers.BooleanField(), "documentsAvailable": serializers.BooleanField(),
        "eventsAvailable": serializers.BooleanField(),
    }), description="menu.read. Published eligible same-Site destination choices; disabled modules return empty choices.")
    @action(detail=False, methods=["get"])
    def targets(self, request, *args, **kwargs):
        from apps.api.models import Post, Category
        from ..models import Page, ContentStatus
        from ..menu_destinations import resolve_destination
        from apps.sites.selectors.modules import module_is_available
        from types import SimpleNamespace
        with menu_errors(), hierarchy_write():
            site = self._site()
            result = {
                "pages": [], "posts": [], "categories": [],
                "pagesAvailable": module_is_available(site.pk, "PAGES"),
                "postsAvailable": module_is_available(site.pk, "POSTS"),
                "documentsAvailable": module_is_available(site.pk, "DOCUMENTS"),
                "eventsAvailable": module_is_available(site.pk, "EVENTS"),
            }
            for kind, model, output in (("page",Page,"pages"),("post",Post,"posts"),("category",Category,"categories")):
                if not result["pagesAvailable" if kind == "page" else "postsAvailable"]: continue
                for row in model.objects.filter(site=site,status=ContentStatus.PUBLISHED,**({} if kind=="category" else {"draft_of__isnull":True})).order_by("name" if kind=="category" else "title","pk"):
                    item = SimpleNamespace(item_type=kind,site_id=site.pk,page_id=row.pk if kind=="page" else None,post_id=row.pk if kind=="post" else None,category_id=row.pk if kind=="category" else None)
                    if resolve_destination(item): result[output].append({"id":str(row.pk),"label":row.name if kind=="category" else row.title})
            return Response(result)

    @extend_schema(parameters=[ListQuery], responses=MenuOutput(many=True), description="menu.read; includes active and inactive menus. Ordered by name then UUID; search matches name or code. Page size 20, maximum 100.")
    def list(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            site = self._site()
            query = self._query(ListQuery)
            from django.db.models import Prefetch
            from ..menu_destinations import SNAPSHOT_FIELDS
            rows = Menu.objects.filter(site=site).order_by("name", "id").prefetch_related(Prefetch(
                "items", queryset=MenuItem.objects.only("menu_id", *SNAPSHOT_FIELDS).order_by("sort_order", "id"),
                to_attr="snapshot_item_rows",
            ))
            if query.get("search"):
                from django.db.models import Q
                rows = rows.filter(Q(name__icontains=query["search"]) | Q(code__icontains=query["search"]))
            if "is_active" in query:
                rows = rows.filter(is_active=query["is_active"])
            return self.get_paginated_response(MenuOutput(self.paginate_queryset(rows), many=True).data)

    @extend_schema(responses=MenuOutput, description="menu.read. ETag versions the entire Menu and all its items.")
    def retrieve(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            return self._response(MenuOutput(menu).data, menu)

    @extend_schema(request=MenuInput, responses={201: MenuOutput}, examples=[OpenApiExample("Draft header", value={"name": "Main navigation", "location": "header"}, request_only=True)],
        description="menu.write. Creates an inactive local draft. Stable codes are unique per Site. Optional non-empty locations remain unique per Site; multiple unassigned menus are supported. is_global requires platform-scoped menu.write and the main Site. No If-Match for creation.")
    def create(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            site = self._site()
            reject_idempotency(request)
            fields = self._input(MenuInput)
            fields.setdefault("is_global", False)
            menu = domain.create_menu(actor=request.user, site_id=site.pk, is_active=False, **fields)
            return self._response(MenuOutput(menu).data, menu, status=201,
                location=reverse("sites:menu-detail", kwargs={"site_pk": site.pk, "pk": menu.pk}))

    @extend_schema(parameters=[IF_MATCH], request=MenuPatch, responses=MenuOutput, description="menu.write; active menus also require menu.publish. A central menu also requires platform-scoped menu.write. Scope, activation and version cannot be patched.")
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

    @extend_schema(parameters=[IF_MATCH], request=ReorderInput, responses=TreeOutput, description="menu.write. Stages an atomic sibling reorder on the working tree (public snapshot unchanged until activate). Supply every sibling UUID exactly once; parent=null selects roots. Missing, duplicate or foreign IDs return invalid_order; stale If-Match returns 409 version_conflict.")
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

    @extend_schema(parameters=[IF_MATCH], request=EmptyInput, responses=MenuOutput, description="menu.publish. Publish the current ordered item snapshot after destination eligibility checks; linked content is never published implicitly.")
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
        return {key + "_id" if key in {"page", "post", "category", "parent"} else key: value for key, value in body.items()}

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

    @extend_schema(parameters=[IF_MATCH], request=ItemInput, responses={201: ItemOutput}, description="menu.write. Stages an item on the working tree; the public snapshot stays frozen until activate. Site/menu identity derives from the URL. Missing sort_order appends to siblings. Targets must belong to this Site.")
    def create(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            reject_idempotency(request)
            item = domain.create_menu_item(menu.pk, actor=request.user, expected=self._expected(), **self._fields(self._input(ItemInput)))
            return self._response(ItemOutput(item).data, menu, status=201,
                location=reverse("sites:menu-item-detail", kwargs={"site_pk": menu.site_id, "menu_pk": menu.pk, "pk": item.pk}))

    @extend_schema(parameters=[IF_MATCH], request=ItemPatch, responses=ItemOutput, description="menu.write. Stages an item edit on the working tree; the public snapshot stays frozen until activate. Use move/reorder for parent and sibling positions. Unsafe targets return invalid_target.")
    def partial_update(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            item = self._item(menu)
            item = domain.update_menu_item(item.pk, actor=request.user, expected=self._expected(), **self._fields(self._input(ItemPatch)))
            return self._response(ItemOutput(item).data, menu)

    @extend_schema(parameters=[IF_MATCH], responses={204: None}, description="menu.write. Stages leaf deletion on the working tree; the public snapshot stays frozen until activate. A non-leaf returns 409 children_present. Response ETag is the new owning Menu token.")
    def destroy(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            item = self._item(menu)
            domain.delete_menu_record(item.pk, actor=request.user, expected=self._expected(), item=True)
            return self._response(None, menu, status=204)

    @extend_schema(parameters=[IF_MATCH], request=MoveInput, responses=ItemOutput, description="menu.write. Stages an atomic subtree move on the working tree; the public snapshot stays frozen until activate. Position is the zero-based destination sibling index. One top-level item plus five submenu levels are supported. Cycles and excessive descendant depth return invalid_tree and roll back every changed position.")
    @action(detail=True, methods=["post"])
    def move(self, request, *args, **kwargs):
        with menu_errors(), hierarchy_write():
            menu = self._menu()
            item = self._item(menu)
            body = self._input(MoveInput)
            item = domain.move_menu_item(item.pk, actor=request.user, expected=self._expected(), parent_id=body["parent"], position=body["position"])
            return self._response(ItemOutput(item).data, menu)
