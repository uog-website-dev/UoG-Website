"""Approved shape for a Module configuration schema.

This describes settings a shipped module may accept. It does not store site
values and it does not make a planned module usable.
"""
import re

from django.core.exceptions import ValidationError

CURRENT_SCHEMA_VERSION = 1
PROPERTY_TYPES = frozenset({"boolean", "string", "integer"})
PROPERTY_CODE = re.compile(r"\A[A-Z][A-Z0-9_]{0,31}\Z")
SECRET_CODE = re.compile(r"password|secret|token|credential|api_key|private_key|session", re.IGNORECASE)
MAX_PROPERTIES = 30


def empty_module_schema():
    """Return an independent empty schema. Callers may mutate the result."""
    return {"schema_version": CURRENT_SCHEMA_VERSION, "properties": []}


def normalize_module_schema(document):
    if document == {}:
        document = empty_module_schema()
    if not isinstance(document, dict):
        raise ValidationError({"configuration_schema": "Module configuration schema must be a JSON object."})
    _reject_secret_keys(document)
    if set(document) != {"schema_version", "properties"} or document.get("schema_version") != CURRENT_SCHEMA_VERSION or isinstance(document.get("schema_version"), bool):
        raise ValidationError({"configuration_schema": "Unsupported module configuration schema."})
    properties = document["properties"]
    if not isinstance(properties, list) or len(properties) > MAX_PROPERTIES:
        raise ValidationError({"configuration_schema": "Module configuration properties are not approved."})
    codes = []
    normalized = []
    for item in properties:
        if not isinstance(item, dict) or set(item) != {"code", "label", "type", "required"}:
            raise ValidationError({"configuration_schema": "Module configuration properties are not approved."})
        code = item["code"]
        label = item["label"]
        if (
            not isinstance(code, str) or PROPERTY_CODE.fullmatch(code) is None or SECRET_CODE.search(code)
            or not isinstance(label, str) or not label.strip() or label != label.strip() or len(label) > 80
            or item["type"] not in PROPERTY_TYPES
            or not isinstance(item["required"], bool)
        ):
            raise ValidationError({"configuration_schema": "Module configuration properties are not approved."})
        codes.append(code)
        normalized.append({"code": code, "label": label, "type": item["type"], "required": item["required"]})
    if len(set(codes)) != len(codes):
        raise ValidationError({"configuration_schema": "Module configuration property codes must be unique."})
    return {"schema_version": CURRENT_SCHEMA_VERSION, "properties": normalized}


def empty_site_module_configuration():
    return {}


def normalize_site_module_configuration(schema, document):
    """Validate one Site's settings against the module's approved schema."""
    if document is None or document == {}:
        document = {}
    if not isinstance(document, dict):
        raise ValidationError({"configuration": "Site module configuration must be a JSON object."})
    _reject_secret_keys(document, "configuration")
    properties = schema.get("properties", []) if isinstance(schema, dict) else None
    if not isinstance(properties, list):
        raise ValidationError({"configuration": "Site module configuration is not approved."})
    allowed = {item["code"]: item for item in properties}
    unknown = set(document) - set(allowed)
    if unknown:
        raise ValidationError({"configuration": "Site module configuration is not approved."})
    normalized = {}
    for code, spec in allowed.items():
        if code not in document:
            if spec["required"]:
                raise ValidationError({"configuration": "Site module configuration is missing a required property."})
            continue
        normalized[code] = _property_value(document[code], spec["type"])
    return normalized


def _property_value(value, expected):
    if expected == "boolean":
        if not isinstance(value, bool):
            raise ValidationError({"configuration": "Site module configuration is not approved."})
        return value
    if expected == "string":
        if not isinstance(value, str) or not value.strip() or value != value.strip() or len(value) > 500:
            raise ValidationError({"configuration": "Site module configuration is not approved."})
        return value
    if expected == "integer" and isinstance(value, int) and not isinstance(value, bool):
        return value
    raise ValidationError({"configuration": "Site module configuration is not approved."})


def _reject_secret_keys(value, field="configuration_schema"):
    if isinstance(value, dict):
        for key, child in value.items():
            if SECRET_CODE.search(str(key)):
                raise ValidationError({field: "Module configuration schema cannot describe secrets."})
            _reject_secret_keys(child, field)
    elif isinstance(value, list):
        for child in value:
            _reject_secret_keys(child, field)
