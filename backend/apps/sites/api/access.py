"""Shared administration access, conditional writes and error translation."""
import hashlib
import json
from contextlib import contextmanager

from django.conf import settings
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import DatabaseError
from rest_framework import serializers, viewsets
from rest_framework.exceptions import APIException, NotFound
from rest_framework.parsers import JSONParser
from rest_framework.permissions import BasePermission, IsAuthenticated, SAFE_METHODS
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.accounts.permissions import HasRealmRole


class Conflict(APIException):
    status_code = 409
    default_detail = "The request conflicts with the current resource state."


class PreconditionRequired(APIException):
    status_code = 428
    default_detail = "Supply the current detail response ETag in If-Match."


class PreconditionFailed(APIException):
    status_code = 412
    default_detail = "The resource changed. Retrieve it and reconcile your changes."


class DevelopmentWritesOnly(BasePermission):
    message = "Administration writes require development mode and explicit opt-in; production writes await scoped IAM/RBAC."

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or (
            settings.DEBUG and settings.ORGANIZATIONS_DEV_WRITES_ENABLED
        )


@contextmanager
def translate_domain_errors():
    try:
        yield
    except DomainValidationError as exc:
        errors = getattr(exc, "message_dict", {"non_field_errors": exc.messages})
        text = " ".join(str(item) for item in errors.values()) if isinstance(errors, dict) else str(errors)
        if "already exists" in text or "already has a primary" in text:
            raise Conflict(errors) from exc
        raise serializers.ValidationError(errors) from exc
    except DatabaseError as exc:
        cause = exc.__cause__
        if getattr(getattr(cause, "diag", None), "constraint_name", None) == "site_domain_primary_deactivate":
            raise serializers.ValidationError({
                "replacement": ["Select an active domain on this Site before deactivating the primary."],
            }) from exc
        if getattr(cause, "sqlstate", None) in {"23505", "23503", "23514", "40001", "40P01"}:
            raise Conflict() from exc
        raise


def reject_idempotency(request):
    if request.headers.get("Idempotency-Key") is not None:
        raise serializers.ValidationError({
            "Idempotency-Key": ["Replay is not supported. Resolve an uncertain create with the resource's unique code or hostname."],
        })


def require_if_match(request, etag):
    supplied = request.headers.get("If-Match")
    if not supplied:
        raise PreconditionRequired()
    if supplied != etag:
        raise PreconditionFailed()


def representation(serializer_class, instance):
    data = serializer_class(instance).data
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return data, f'"{digest}"'


class AdministrationViewSet(viewsets.GenericViewSet):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated, HasRealmRole, DevelopmentWritesOnly]
    required_roles = {"platform-admin"}
    http_method_names = ["get", "post", "patch", "head", "options"]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def respond(self, instance, *, serializer_class, status=200, location=None):
        data, etag = representation(serializer_class, instance)
        response = Response(data, status=status, headers={"ETag": etag, "Cache-Control": "private, no-store"})
        if location:
            response["Location"] = location
        return response

    def lock(self, request, queryset, serializer_class):
        try:
            instance = queryset.select_for_update(of=("self",)).get(pk=self.kwargs["pk"])
        except queryset.model.DoesNotExist as exc:
            raise NotFound() from exc
        require_if_match(request, representation(serializer_class, instance)[1])
        return instance
