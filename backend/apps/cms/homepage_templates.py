"""Approved, versioned starting documents; no Page or Site writes."""
import copy
import json
from pathlib import Path
from django.core.exceptions import ValidationError
from apps.sites.selectors.modules import available_module_codes
from .layout_contract import validate_layout, iter_nodes
from .services.section_templates import remap_section_ids

MANIFESTS = tuple(json.loads((Path(__file__).parent / "schemas/homepage" / (code + ".json")).read_text(encoding="utf-8"))
                  for code in ("university-main", "college-department", "blank"))
# Templates are intentionally independent of live media, menus and Post queries.
STATIC_WIDGETS = frozenset({"headline", "editor", "features", "call_to_action", "button", "button_grid", "alert"})


def validate_manifest(value):
    required = {"manifest_version", "id", "version", "name", "description", "required_modules", "layout"}
    if not isinstance(value, dict) or set(value) != required:
        raise ValidationError({"manifest": "Use the complete approved manifest format."})
    if type(value["manifest_version"]) is not int or value["manifest_version"] != 1:
        raise ValidationError({"manifest_version": "Unsupported template manifest version."})
    if type(value["version"]) is not int or value["version"] < 1:
        raise ValidationError({"version": "Use a positive template version."})
    for field, limit in (("id",80),("name",120),("description",1000)):
        if not isinstance(value[field],str) or not 1 <= len(value[field]) <= limit:
            raise ValidationError({field: "Use bounded, nonempty text."})
    if value["required_modules"] != ["PAGES", "VISUAL_BUILDER"]:
        raise ValidationError({"required_modules": "Declare PAGES and VISUAL_BUILDER dependencies."})
    layout = validate_layout(value["layout"], prefix="layout")
    for node, path in iter_nodes(layout, prefix="layout"):
        if node["type"] not in STATIC_WIDGETS | {"section", "column"}:
            raise ValidationError({path + ".type": "Starting templates must use approved static components without Site references."})
    return copy.deepcopy({**value,"layout":layout})


def catalogue(site_id):
    available = available_module_codes(site_id)
    entries = []
    for source in MANIFESTS:
        reasons = []
        entry = {}
        try:
            entry = validate_manifest(source)
        except ValidationError as error:
            reasons.extend(error.messages)
            raw = source if isinstance(source, dict) else {}
            entry = {"manifest_version": raw.get("manifest_version") if type(raw.get("manifest_version")) is int else 0,
                     "id": raw.get("id") if isinstance(raw.get("id"),str) else "invalid-template",
                     "version": raw.get("version") if type(raw.get("version")) is int else 0,
                     "name": raw.get("name") if isinstance(raw.get("name"),str) else "Unavailable template",
                     "description": raw.get("description") if isinstance(raw.get("description"),str) else "Invalid approved manifest.",
                     "required_modules": ["PAGES","VISUAL_BUILDER"], "layout": None}
        missing = [code for code in entry["required_modules"] if code not in available]
        if missing:
            reasons.append("Enable required modules: " + ", ".join(missing) + ".")
        entries.append({**entry,"available":not reasons,"unavailable_reasons":reasons})
    return entries


def prepare_template(site_id, template_id, version):
    entry = next((item for item in catalogue(site_id) if item["id"] == template_id), None)
    if not entry:
        raise ValidationError({"template": "Unknown approved template."})
    if not entry["available"]:
        raise ValidationError({"template": entry["unavailable_reasons"]})
    if type(version) is not int or version != entry["version"]:
        raise ValidationError({"version": "Template version changed. Reload the catalogue."})
    # IDs become unique per selection; the existing Page draft API owns persistence.
    return {"template_id":template_id,"template_version":version,"visual_layout":validate_layout(remap_section_ids(entry["layout"]))}

