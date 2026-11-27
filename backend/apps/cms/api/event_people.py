"""Site-scoped Event people and session role assignment APIs."""
from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.cms.event_domain import require_events_admin
from apps.cms.event_models import Event
from apps.cms.event_person_domain import (
    PersonConflict,
    PersonPreconditionRequired,
    active_assignments,
    active_people,
    assign_person,
    create_person,
    person_etag,
    remove_person,
    reorder_assignments,
    serialize_assignment,
    serialize_person,
    unassign_person,
    update_assignment,
    update_person,
)
from apps.cms.event_person_models import EventPerson, SessionPerson, SessionPersonRole
from apps.cms.event_session_models import EventSession, SessionVisibility
from apps.sites.api.access import PreconditionFailed, PreconditionRequired, translate_domain_errors
from apps.sites.events import EVENTS_MODULE_CODE
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available


class StrictFields:
    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            forbidden = set(data) - writable
            if forbidden:
                raise serializers.ValidationError({
                    key: ["Unknown, read-only, or immutable field."] for key in sorted(forbidden)
                })
        return super().to_internal_value(data)


class PublicLinkSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=120)
    url = serializers.CharField(max_length=2048)


class EventPersonSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    event = serializers.UUIDField(read_only=True)
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    affiliation = serializers.CharField(required=False, allow_blank=True, max_length=255)
    biography = serializers.CharField(required=False, allow_blank=True)
    profile_photo = serializers.UUIDField(required=False, allow_null=True)
    profile_photo_url = serializers.CharField(read_only=True, allow_null=True)
    public_links = PublicLinkSerializer(many=True, required=False)
    visibility = serializers.ChoiceField(choices=SessionVisibility.choices, required=False)
    private_email = serializers.EmailField(required=False, allow_blank=True)
    private_phone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    verified_account = serializers.IntegerField(required=False, allow_null=True)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    version = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
    removed_at = serializers.DateTimeField(read_only=True, allow_null=True)


class SessionPersonSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    session = serializers.UUIDField(read_only=True)
    person = serializers.UUIDField(required=False)
    role = serializers.ChoiceField(choices=SessionPersonRole.choices, required=False)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    person_summary = serializers.DictField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class SessionPersonReorderSerializer(StrictFields, serializers.Serializer):
    order = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)


def _site(site_pk: int) -> Site:
    site = get_object_or_404(Site, pk=site_pk)
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")
    return site


def _load_event(request, site_pk, event_id) -> Event:
    site = _site(site_pk)
    require_events_admin(request.user, site)
    return get_object_or_404(Event, pk=event_id, site_id=site.pk)


def _load_person(request, site_pk, event_id, person_id) -> EventPerson:
    event = _load_event(request, site_pk, event_id)
    return get_object_or_404(EventPerson, pk=person_id, event_id=event.pk)


def _load_session(request, site_pk, event_id, session_id) -> EventSession:
    event = _load_event(request, site_pk, event_id)
    return get_object_or_404(EventSession, pk=session_id, event_id=event.pk)


class SiteEventPeople(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_event_people_list",
        tags=["Event People"],
        responses={200: EventPersonSerializer(many=True)},
        parameters=[OpenApiParameter("search", str)],
    )
    def get(self, request, site_pk, event_id):
        event = _load_event(request, site_pk, event_id)
        rows = active_people(event)
        search = request.query_params.get("search", "").strip()
        if search:
            rows = rows.filter(
                Q(display_name__icontains=search)
                | Q(affiliation__icontains=search)
                | Q(private_email__icontains=search)
            )
        rows = rows.order_by("sort_order", "display_name", "id")
        return Response({"results": [serialize_person(row, public=False) for row in rows]})

    @extend_schema(
        operation_id="v1_sites_event_people_create",
        tags=["Event People"],
        request=EventPersonSerializer,
        responses={201: EventPersonSerializer},
    )
    def post(self, request, site_pk, event_id):
        event = _load_event(request, site_pk, event_id)
        serializer = EventPersonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            person = create_person(event, serializer.validated_data, actor=request.user)
        response = Response(serialize_person(person, public=False), status=201)
        response["ETag"] = person_etag(person)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventPersonDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_event_people_retrieve",
        tags=["Event People"],
        responses={200: EventPersonSerializer},
    )
    def get(self, request, site_pk, event_id, person_id):
        person = _load_person(request, site_pk, event_id, person_id)
        if person.removed_at is not None:
            raise NotFound("Person not found.")
        response = Response(serialize_person(person, public=False))
        response["ETag"] = person_etag(person)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_event_people_partial_update",
        tags=["Event People"],
        request=EventPersonSerializer,
        responses={200: EventPersonSerializer},
    )
    def patch(self, request, site_pk, event_id, person_id):
        person = _load_person(request, site_pk, event_id, person_id)
        serializer = EventPersonSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            try:
                person = update_person(
                    person, serializer.validated_data, actor=request.user,
                    expected=request.headers.get("If-Match"),
                )
            except PersonPreconditionRequired as error:
                raise PreconditionRequired() from error
            except PersonConflict as error:
                raise PreconditionFailed() from error
        response = Response(serialize_person(person, public=False))
        response["ETag"] = person_etag(person)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_event_people_destroy",
        tags=["Event People"],
        responses={200: EventPersonSerializer},
    )
    def delete(self, request, site_pk, event_id, person_id):
        person = _load_person(request, site_pk, event_id, person_id)
        with translate_domain_errors():
            try:
                person = remove_person(
                    person, actor=request.user, expected=request.headers.get("If-Match"),
                )
            except PersonPreconditionRequired as error:
                raise PreconditionRequired() from error
            except PersonConflict as error:
                raise PreconditionFailed() from error
        response = Response(serialize_person(person, public=False))
        response["ETag"] = person_etag(person)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventSessionPeople(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_event_session_people_list",
        tags=["Event People"],
        responses={200: SessionPersonSerializer(many=True)},
    )
    def get(self, request, site_pk, event_id, session_id):
        session = _load_session(request, site_pk, event_id, session_id)
        rows = active_assignments(session).order_by("sort_order", "role", "id")
        return Response({"results": [serialize_assignment(row, public=False) for row in rows]})

    @extend_schema(
        operation_id="v1_sites_event_session_people_create",
        tags=["Event People"],
        request=SessionPersonSerializer,
        responses={201: SessionPersonSerializer},
    )
    def post(self, request, site_pk, event_id, session_id):
        session = _load_session(request, site_pk, event_id, session_id)
        serializer = SessionPersonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        person_id = serializer.validated_data.get("person")
        if not person_id:
            raise serializers.ValidationError({"person": ["Choose an Event person."]})
        person = EventPerson.objects.filter(pk=person_id, event_id=session.event_id).first()
        if person is None:
            raise serializers.ValidationError({"person": ["Choose a person from this Event."]})
        with translate_domain_errors():
            assignment = assign_person(
                session,
                person=person,
                role=serializer.validated_data.get("role", SessionPersonRole.SPEAKER),
                sort_order=serializer.validated_data.get("sort_order"),
                actor=request.user,
            )
        return Response(serialize_assignment(assignment, public=False), status=201)


class SiteEventSessionPersonDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    def _load(self, request, site_pk, event_id, session_id, assignment_id) -> SessionPerson:
        session = _load_session(request, site_pk, event_id, session_id)
        return get_object_or_404(SessionPerson, pk=assignment_id, session_id=session.pk)

    @extend_schema(
        operation_id="v1_sites_event_session_people_partial_update",
        tags=["Event People"],
        request=SessionPersonSerializer,
        responses={200: SessionPersonSerializer},
    )
    def patch(self, request, site_pk, event_id, session_id, assignment_id):
        assignment = self._load(request, site_pk, event_id, session_id, assignment_id)
        serializer = SessionPersonSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            assignment = update_assignment(assignment, serializer.validated_data, actor=request.user)
        return Response(serialize_assignment(assignment, public=False))

    @extend_schema(
        operation_id="v1_sites_event_session_people_destroy",
        tags=["Event People"],
        responses={204: None},
    )
    def delete(self, request, site_pk, event_id, session_id, assignment_id):
        assignment = self._load(request, site_pk, event_id, session_id, assignment_id)
        with translate_domain_errors():
            unassign_person(assignment, actor=request.user)
        return Response(status=204)


class SiteEventSessionPeopleReorder(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "head", "options"]

    @extend_schema(
        operation_id="v1_sites_event_session_people_reorder",
        tags=["Event People"],
        request=SessionPersonReorderSerializer,
        responses={200: SessionPersonSerializer(many=True)},
    )
    def post(self, request, site_pk, event_id, session_id):
        session = _load_session(request, site_pk, event_id, session_id)
        serializer = SessionPersonReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            rows = reorder_assignments(
                session,
                [str(value) for value in serializer.validated_data["order"]],
                actor=request.user,
            )
        return Response({"results": [serialize_assignment(row, public=False) for row in rows]})
