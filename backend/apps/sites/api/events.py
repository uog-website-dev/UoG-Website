"""Event Management settings serializers and envelopes."""
from rest_framework import serializers

from .serializers import StrictFields
from ..events import event_settings_values, get_event_settings_payload
from ..models.event_settings import SiteEventSettings
from ..selectors.modules import available_module_codes


class EventSettingsSerializer(StrictFields, serializers.Serializer):
    timezone = serializers.CharField(max_length=64, required=False)
    public_list_path = serializers.CharField(max_length=2048, required=False)
    registration_required_by_default = serializers.BooleanField(required=False)
    registration_default_capacity = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    public_aggregation_eligible = serializers.BooleanField(required=False)
    block_publish_on_session_room_conflicts = serializers.BooleanField(required=False)
    hide_cancelled_sessions_publicly = serializers.BooleanField(required=False)


class EventSettingsEnvelopeSerializer(serializers.Serializer):
    site = serializers.IntegerField()
    version = serializers.IntegerField()
    settings = EventSettingsSerializer()
    updated_at = serializers.CharField(allow_null=True)
    modules = serializers.ListField(child=serializers.CharField())
    # Aggregation eligibility never authorizes cross-Site writes.
    aggregation_write_access = serializers.BooleanField()


def event_settings_envelope(site, row: SiteEventSettings | None) -> dict:
    payload = get_event_settings_payload(row)
    return {
        "site": site.pk,
        "version": payload["version"],
        "settings": event_settings_values(row),
        "updated_at": payload["updated_at"],
        "modules": sorted(available_module_codes(site.pk)),
        "aggregation_write_access": False,
    }
