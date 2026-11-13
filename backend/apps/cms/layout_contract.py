"""Visual-layout v1. Legacy blocks remain a separate, unchanged contract."""
import copy
import json
import math
import re
from pathlib import Path

from django.core.exceptions import ValidationError

SCHEMA = json.loads((Path(__file__).parent / "schemas/layout/layout-v1.schema.json").read_text())
REGISTRY = tuple(SCHEMA["x-registry"])
MAX_BYTES = SCHEMA["x-limits"]["max_bytes"]


def validate_layout(value, *, prefix="metadata.visual_layout"):
    """Validate without mutating input; return stable identity/order unchanged."""
    errors = {}

    def reject(path, message):
        errors.setdefault(path, []).append(message)

    try:
        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")) > MAX_BYTES:
            raise ValidationError({prefix: f"Layout exceeds {MAX_BYTES} bytes."})
    except (ValueError, TypeError, RecursionError) as error:
        raise ValidationError({prefix: "Use a bounded JSON document."}) from error

    def check(data, schema, path):
        if "oneOf" in schema:
            candidate = next((item for item in schema["oneOf"] if isinstance(data, dict) and item["properties"]["type"]["const"] == data.get("type")), None)
            if candidate is None:
                reject(path + ".type", "Unknown widget or nested Section. Use a registered leaf widget.")
            else:
                check(data, candidate, path)
            return
        if "const" in schema and (type(data) is not type(schema["const"]) or data != schema["const"]):
            reject(path, "Unsupported value or schema version.")
        if "enum" in schema and not any(type(data) is type(item) and data == item for item in schema["enum"]):
            reject(path, "Use an approved token or column ratio.")
        kind = schema.get("type")
        valid = {"object": isinstance(data, dict), "array": isinstance(data, list), "string": isinstance(data, str),
                 "boolean": type(data) is bool, "integer": type(data) is int,
                 "number": type(data) is int or (type(data) is float and math.isfinite(data))}
        if kind and not valid[kind]:
            reject(path, f"Expected {kind}."); return
        if kind == "object":
            props = schema["properties"]
            for key in schema.get("required", []):
                if key not in data: reject(f"{path}.{key}", "This field is required.")
            for key, child in data.items():
                if key not in props: reject(f"{path}.{key}", "Unsupported field.")
                else: check(child, props[key], f"{path}.{key}")
        elif kind == "array":
            if len(data) < schema.get("minItems", 0) or len(data) > schema.get("maxItems", 200):
                reject(path, "Item count exceeds the allowed bounds."); return
            for index, child in enumerate(data): check(child, schema["items"], f"{path}[{index}]")
        elif kind == "string":
            if not schema.get("minLength", 0) <= len(data) <= schema.get("maxLength", 20000): reject(path, "Text length exceeds the allowed bounds.")
            if "pattern" in schema and re.fullmatch(schema["pattern"], data) is None: reject(path, "Invalid identifier, date or safe link.")
            if any(ord(c) < 32 and c not in "\n\r\t" for c in data): reject(path, "Control characters are not allowed.")
        elif kind in ("number", "integer"):
            if not schema.get("minimum", -math.inf) <= data <= schema.get("maximum", math.inf): reject(path, "Number exceeds the allowed bounds.")

    check(value, SCHEMA, prefix)
    if errors: raise ValidationError(errors)
    seen = set()
    count = 0
    for row_index, row in enumerate(value["rows"]):
        if len(row["ratios"]) != len(row["columns"]): reject(f"{prefix}.rows[{row_index}].ratios", "Ratios must match the ordered column count.")
    for node, node_path in iter_nodes(value, prefix=prefix):
        count += 1
        if node["id"] in seen: reject(node_path + ".id", "Node IDs must be unique across the document.")
        seen.add(node["id"])
        item_ids = set()
        for index, item in enumerate(node.get("props", {}).get("items", [])):
            if item["id"] in item_ids: reject(f"{node_path}.props.items[{index}].id", "Repeated item IDs must be unique within a widget.")
            item_ids.add(item["id"])
        action_ids = set()
        for index, action in enumerate(node.get("props", {}).get("actions", [])):
            if action["id"] in action_ids: reject(f"{node_path}.props.actions[{index}].id", "Action IDs must be unique within a widget.")
            action_ids.add(action["id"])
    if count > SCHEMA["x-limits"]["max_nodes"]: reject(prefix + ".rows", "Layout exceeds 200 nodes.")
    if errors: raise ValidationError(errors)
    cleaned = copy.deepcopy(value)
    from .blocks import sanitize_rich_text
    for node, path in iter_nodes(cleaned, prefix=prefix):
        if node["type"] == "editor":
            node["props"]["html"] = sanitize_rich_text(node["props"]["html"])
    return cleaned


def iter_nodes(layout, *, prefix="metadata.visual_layout"):
    def leaf(node, path):
        yield node, path
        for i, item in enumerate(node.get("props", {}).get("items", [])):
            for j, child in enumerate(item.get("children", [])):
                yield from leaf(child, f"{path}.props.items[{i}].children[{j}]")
    for i, row in enumerate(layout["rows"]):
        path = f"{prefix}.rows[{i}]"
        yield row, path
        for j, column in enumerate(row["columns"]):
            column_path = f"{path}.columns[{j}]"
            yield column, column_path
            for k, widget in enumerate(column["children"]):
                yield from leaf(widget, f"{column_path}.children[{k}]")


def validate_layout_media(layout, *, site_id):
    from .blocks import check_image_ref, Rejection
    for node, node_path in iter_nodes(layout):
        props = node.get("props", {})
        references = []
        if node["type"] in {"image", "hero_image"}:
            references = [(props["asset_id"], node_path + ".props.asset_id")]
        elif node["type"] in {"image_slider", "image_grid"}:
            references = [(item["asset_id"], f"{node_path}.props.items[{i}].asset_id") for i, item in enumerate(props["items"])]
        for asset_id, field_path in references:
            try:
                check_image_ref(f"sites/{site_id}/assets/{asset_id}", site_id=site_id)
            except Rejection as error:
                raise ValidationError({field_path: str(error)}) from error


def layout_error_locations(layout, fields):
    """Attach stable node/item identity to field paths without trusting shape."""
    def stable_id(value):
        return value if isinstance(value,str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}",value) else None

    locations = []
    prefix = "metadata.visual_layout"
    for path, messages in fields.items():
        current = layout
        node_id = item_id = item_index = None
        previous = None
        suffix = path[len(prefix):] if path.startswith(prefix) else ""
        for token in re.findall(r"[^.\[\]]+", suffix):
            if isinstance(current, dict):
                if "type" in current:
                    node_id = stable_id(current.get("id"))
                current = current.get(token)
            elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
                current = current[int(token)]
                if previous == "items":
                    item_index = int(token)
                    item_id = stable_id(current.get("id")) if isinstance(current, dict) else None
            else:
                break
            previous = token
        if isinstance(current, dict) and "type" in current:
            node_id = stable_id(current.get("id"))
        locations.append({"path": path, "node_id": node_id, "item_id": item_id,
                          "item_index": item_index, "messages": messages if isinstance(messages, list) else [messages]})
    return locations

