"""Approved, versioned starting documents; no Page or Site writes."""
import copy
import json
import re
from pathlib import Path
from django.core.exceptions import ValidationError
from apps.sites.selectors.modules import available_module_codes
from .layout_contract import validate_layout, iter_nodes
from .services.section_templates import remap_section_ids

MANIFESTS = tuple(json.loads((Path(__file__).parent / "schemas/homepage" / (code + ".json")).read_text(encoding="utf-8"))
                  for code in ("university-main", "college-department", "blank"))
# Only existing Sprint 3 widgets are allowed. The dynamic entries resolve data
# from the active Site through the public widget runtime; manifests never carry
# Site IDs or media URLs.
EDITABLE_WIDGETS = frozenset({"headline", "editor", "features", "call_to_action", "button", "button_grid", "alert", "layout_slider", "anything_carousel", "hero_image", "image", "tabs", "accordion", "menu_anchor", "contact_form", "icon"})
# Site branding and menus come from the global header. Homepage templates may
# only use dynamic content (loop_grid); chrome widgets are never allowed.
SITE_WIDGETS = frozenset({"loop_grid"})
CHROME_WIDGETS = frozenset({"site_logo", "site_title", "menu"})


def validate_manifest(value):
    required = {"manifest_version", "id", "version", "name", "description", "required_modules", "layout"}
    if not isinstance(value, dict) or set(value) - {"media_slots"} != required:
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
        if node["type"] in CHROME_WIDGETS:
            raise ValidationError({path + ".type": "Site logo, Site title and menu belong to the global header and are not allowed in homepage templates."})
        if node["type"] not in EDITABLE_WIDGETS | SITE_WIDGETS | {"section", "column"}:
            raise ValidationError({path + ".type": "Starting templates must use registered approved components."})
        if node["type"] == "loop_grid" and node["props"].get("source") != "posts":
            raise ValidationError({path + ".props.source": "Homepage news sections must use published Posts."})
    slots=value.get("media_slots",[])
    if not isinstance(slots,list) or len(slots)>8:
        raise ValidationError({"media_slots":"Use at most eight image slots."})
    nodes={node["id"]:node for node,_ in iter_nodes(layout)}
    codes=set();targets=set()
    for slot in slots:
        if not isinstance(slot,dict) or set(slot)!={"code","label","node_ids"} or not isinstance(slot["code"],str) or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}",slot["code"]) is None or slot["code"] in codes or not isinstance(slot["label"],str) or not 1<=len(slot["label"])<=120 or not isinstance(slot["node_ids"],list) or not 1<=len(slot["node_ids"])<=20:
            raise ValidationError({"media_slots":"Invalid or duplicate image slot."})
        codes.add(slot["code"])
        for identifier in slot["node_ids"]:
            if not isinstance(identifier,str) or identifier in targets or identifier not in nodes or nodes[identifier]["type"] not in {"hero_image","image"}:
                raise ValidationError({"media_slots":"Slots must target distinct registered image nodes."})
            targets.add(identifier)
    image_nodes={node["id"] for node,_ in iter_nodes(layout) if node["type"] in {"hero_image","image"}}
    if any(node["props"]["asset_id"]!="00000000-0000-0000-0000-000000000000" for node,_ in iter_nodes(layout) if node["id"] in image_nodes):
        raise ValidationError({"media_slots":"Template images must be unbound slots, never stored asset IDs."})
    if image_nodes!=targets:
        raise ValidationError({"media_slots":"Every template image must have a Site media slot."})
    return copy.deepcopy({**value,"layout":layout,"media_slots":slots})


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
        if entry.get("media_slots") and "MEDIA" not in available:
            missing.append("MEDIA")
        if missing:
            reasons.append("Enable required modules: " + ", ".join(missing) + ".")
        entries.append({**entry,"available":not reasons,"unavailable_reasons":reasons})
    return entries


def prepare_template(site_id, template_id, version, *, assets=None):
    entry = next((item for item in catalogue(site_id) if item["id"] == template_id), None)
    if not entry:
        raise ValidationError({"template": "Unknown approved template."})
    if not entry["available"]:
        raise ValidationError({"template": entry["unavailable_reasons"]})
    if type(version) is not int or version != entry["version"]:
        raise ValidationError({"version": "Template version changed. Reload the catalogue."})
    bindings=assets or {}
    slots=entry.get("media_slots",[])
    if set(bindings)!={slot["code"] for slot in slots}:
        raise ValidationError({"assets":"Select an approved Site image and alternative text for every image slot."})
    layout=copy.deepcopy(entry["layout"])
    nodes={node["id"]:node for node,_ in iter_nodes(layout)}
    for slot in slots:
        binding=bindings[slot["code"]]
        if not isinstance(binding,dict) or set(binding)!={"asset_id","alt"} or not isinstance(binding["alt"],str) or not 1<=len(binding["alt"].strip())<=255:
            raise ValidationError({"assets."+slot["code"]:"Select an image and meaningful alternative text."})
        for identifier in slot["node_ids"]:
            nodes[identifier]["props"].update(asset_id=str(binding["asset_id"]),alt=binding["alt"].strip())
    if slots:
        from .layout_contract import validate_layout_media
        validate_layout_media(layout,site_id=site_id)
    # IDs become unique per selection; the existing Page draft API owns persistence.
    return {"template_id":template_id,"template_version":version,"visual_layout":validate_layout(remap_section_ids(layout))}

