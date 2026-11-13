"""Wire contract for complete visual draft replacement and editor error binding."""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import APIException
from apps.sites.api.serializers import StrictFields
from ..layout_contract import SCHEMA, layout_error_locations


def openapi_schema(value):
    if isinstance(value, list):
        return [openapi_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {("enum" if key == "const" else key): ([item] if key == "const" else openapi_schema(item))
            for key, item in value.items() if key != "$schema" and not (key == "required" and item == [])}


@extend_schema_field(openapi_schema(SCHEMA))
class VisualLayoutField(serializers.JSONField):
    pass


class VisualDraftInput(StrictFields, serializers.Serializer):
    visual_layout = VisualLayoutField(help_text="Complete schema-versioned tree. Replaces the prior tree; does not merge individual slides or nodes.")


# PATCH replaces this whole field. Do not let schema generation turn every
# property optional just because the HTTP method is PATCH.
VISUAL_DRAFT_REQUEST_SCHEMA = {"type":"object","additionalProperties":False,
                               "required":["visual_layout"],
                               "properties":{"visual_layout":openapi_schema(SCHEMA)}}


class VisualDraftLocationSerializer(serializers.Serializer):
    path = serializers.CharField()
    node_id = serializers.CharField(allow_null=True)
    item_id = serializers.CharField(allow_null=True)
    item_index = serializers.IntegerField(allow_null=True)
    messages = serializers.ListField(child=serializers.CharField())


class VisualDraftDetailsSerializer(serializers.Serializer):
    fields = serializers.DictField(child=serializers.ListField(child=serializers.CharField()))
    nodes = VisualDraftLocationSerializer(many=True)


class VisualDraftErrorBodySerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    details = VisualDraftDetailsSerializer()


class VisualDraftErrorSerializer(serializers.Serializer):
    error = VisualDraftErrorBodySerializer()
    request_id = serializers.CharField(allow_null=True)


class VisualDraftValidationError(APIException):
    status_code = 400

    def __init__(self, error, layout):
        fields = error.message_dict if hasattr(error, "message_dict") else {"non_field_errors": error.messages}
        # Keep item positions as integers; DRF ValidationError stringifies leaves.
        self.detail = {"fields": fields, "nodes": layout_error_locations(layout, fields)}
