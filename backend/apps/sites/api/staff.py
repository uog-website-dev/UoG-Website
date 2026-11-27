"""Staff Directory settings serializers and envelopes."""
from rest_framework import serializers

from .serializers import StrictFields
from ..models.staff_directory_settings import (
    SiteStaffDirectorySettings,
    StaffDirectoryPresentation,
    StaffDirectorySort,
)
from ..selectors.modules import available_module_codes
from ..staff import (
    get_staff_directory_settings_payload,
    resolve_directory_organization_scope,
    staff_directory_settings_values,
)


class StaffDirectorySettingsSerializer(StrictFields, serializers.Serializer):
    page_size = serializers.IntegerField(required=False, min_value=5, max_value=100)
    default_sort = serializers.ChoiceField(choices=StaffDirectorySort.choices, required=False)
    public_list_path = serializers.CharField(max_length=2048, required=False)
    presentation = serializers.ChoiceField(choices=StaffDirectoryPresentation.choices, required=False)
    public_aggregation_eligible = serializers.BooleanField(required=False)


class StaffDirectoryScopeSerializer(serializers.Serializer):
    organization_unit_id = serializers.IntegerField(allow_null=True)
    organization_ids = serializers.ListField(child=serializers.IntegerField())
    mode = serializers.CharField()
    aggregation_site_ids = serializers.ListField(child=serializers.IntegerField())


class StaffDirectorySettingsEnvelopeSerializer(serializers.Serializer):
    site = serializers.IntegerField()
    version = serializers.IntegerField()
    settings = StaffDirectorySettingsSerializer()
    scope = StaffDirectoryScopeSerializer()
    updated_at = serializers.CharField(allow_null=True)
    modules = serializers.ListField(child=serializers.CharField())
    # Aggregation eligibility never authorizes cross-Site writes.
    aggregation_write_access = serializers.BooleanField()


def staff_directory_settings_envelope(site, row: SiteStaffDirectorySettings | None) -> dict:
    payload = get_staff_directory_settings_payload(row)
    return {
        "site": site.pk,
        "version": payload["version"],
        "settings": staff_directory_settings_values(row),
        "scope": resolve_directory_organization_scope(site),
        "updated_at": payload["updated_at"],
        "modules": sorted(available_module_codes(site.pk)),
        "aggregation_write_access": False,
    }
