"""Versioned Site configuration schema.

Persist only this allowlist. Frequently queried language identity stays on
Site.default_language. Extend the schema by adding the next version and an
upgrade function; do not accept arbitrary keys. Configuration rollback is
deferred: audit snapshots retain the previous document.
"""
from copy import deepcopy
import re

from django.core.exceptions import ValidationError

CURRENT_SCHEMA_VERSION = 1
DEFAULT_THEME = "institutional"
THEMES = frozenset({DEFAULT_THEME, "high-contrast"})
BEHAVIOR_FLAGS = ("show_search", "show_language_switcher")
SECTIONS = ("identity", "language", "presentation", "navigation", "behavior")
LANGUAGE_CODE = re.compile(r"\A[a-z]{2,3}(?:-[a-z0-9]{2,8})*\Z")
MEDIA_KEY = re.compile(r"\A[a-z0-9][a-z0-9_-]{0,127}\Z")
NAV_CODE = re.compile(r"\A[A-Z][A-Z0-9_-]{0,31}\Z")
NAV_PATH = re.compile(r"\A/(?:[a-z0-9][a-z0-9_-]{0,63}(?:/[a-z0-9][a-z0-9_-]{0,63})*)?\Z")
SECRET_KEY = re.compile(r"password|secret|token|credential|api_key|private_key|session", re.IGNORECASE)
MAX_LANGUAGES = 10
MAX_NAV_ITEMS = 20


def default_configuration(default_language="en-us"):
    """Return an independent schema document. Callers may mutate the result."""
    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "identity": {"display_name": None, "logo_ref": None, "favicon_ref": None},
        "language": {"enabled": [default_language]},
        "presentation": {"theme": DEFAULT_THEME},
        "navigation": {"items": []},
        "behavior": {flag: False for flag in BEHAVIOR_FLAGS},
    }


def normalize_site_configuration(document, *, default_language):
    """Upgrade an empty or current document into a validated schema document."""
    if document == {} or (document == default_configuration("en-us") and default_language != "en-us"):
        document = default_configuration(default_language)
    return upgrade_configuration(document, default_language=default_language)


def upgrade_configuration(document, *, default_language):
    """Apply the approved upgrade path through the current schema version."""
    if not isinstance(document, dict):
        raise ValidationError({"configuration": "Configuration must be a JSON object."})
    _reject_secret_keys(document)
    version = document.get("schema_version", 0)
    if version == 0:
        if set(document) - {"schema_version"}:
            raise ValidationError({"configuration": "Unsupported configuration properties."})
        document = default_configuration(default_language)
        version = CURRENT_SCHEMA_VERSION
    while version < CURRENT_SCHEMA_VERSION:
        document = UPGRADES[version](document, default_language=default_language)
        version = document["schema_version"]
    if version != CURRENT_SCHEMA_VERSION:
        raise ValidationError({"configuration": "Unsupported configuration schema_version."})
    return _validate_current(document, default_language=default_language)


def merge_site_configuration(current, changes):
    """Merge an allowlisted partial change onto one site's current document."""
    if not isinstance(changes, dict):
        raise ValidationError({"configuration": "Configuration must be a JSON object."})
    _reject_secret_keys(changes)
    unknown = set(changes) - set(SECTIONS) - {"schema_version"}
    if unknown or ("schema_version" in changes and changes["schema_version"] != CURRENT_SCHEMA_VERSION):
        raise ValidationError({"configuration": "Unsupported configuration properties."})
    merged = deepcopy(current)
    for section in SECTIONS:
        if section not in changes:
            continue
        value = changes[section]
        if section in {"language", "navigation"}:
            merged[section] = value
            continue
        if not isinstance(value, dict):
            raise ValidationError({"configuration": f"Configuration {section} must be an object."})
        extra = set(value) - set(merged[section])
        if extra:
            raise ValidationError({"configuration": "Unsupported configuration properties."})
        merged[section] = {**merged[section], **value}
    return merged


def _reject_secret_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if SECRET_KEY.search(str(key)):
                raise ValidationError({"configuration": "Site configuration cannot store secrets."})
            _reject_secret_keys(child)
    elif isinstance(value, list):
        for child in value:
            _reject_secret_keys(child)


def _exact_keys(value, expected, message):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValidationError({"configuration": message})


def _media_ref(value, label):
    if value is None:
        return None
    if not isinstance(value, str) or MEDIA_KEY.fullmatch(value) is None:
        raise ValidationError({"configuration": f"{label} must be null or a future media key."})
    return value


def _validate_current(document, *, default_language):
    _exact_keys(document, ("schema_version", *SECTIONS), "Unsupported configuration properties.")
    if document["schema_version"] != CURRENT_SCHEMA_VERSION or isinstance(document["schema_version"], bool):
        raise ValidationError({"configuration": "Unsupported configuration schema_version."})
    identity = document["identity"]
    _exact_keys(identity, ("display_name", "logo_ref", "favicon_ref"), "Configuration identity does not match the approved schema.")
    display_name = identity["display_name"]
    if display_name is not None and (not isinstance(display_name, str) or not display_name.strip() or display_name != display_name.strip() or len(display_name) > 255):
        raise ValidationError({"configuration": "Identity display_name must be null or a nonblank name."})
    _media_ref(identity["logo_ref"], "logo_ref")
    _media_ref(identity["favicon_ref"], "favicon_ref")
    language = document["language"]
    _exact_keys(language, ("enabled",), "Configuration language does not match the approved schema.")
    enabled = language["enabled"]
    if (
        not isinstance(enabled, list) or not 1 <= len(enabled) <= MAX_LANGUAGES
        or len(set(enabled)) != len(enabled)
        or any(not isinstance(code, str) or LANGUAGE_CODE.fullmatch(code) is None for code in enabled)
        or default_language not in enabled
    ):
        raise ValidationError({"configuration": "Enabled languages must include the Site default language."})
    presentation = document["presentation"]
    _exact_keys(presentation, ("theme",), "Configuration presentation does not match the approved schema.")
    if presentation["theme"] not in THEMES:
        raise ValidationError({"configuration": "Presentation theme is not approved."})
    navigation = document["navigation"]
    _exact_keys(navigation, ("items",), "Configuration navigation does not match the approved schema.")
    items = navigation["items"]
    if not isinstance(items, list) or len(items) > MAX_NAV_ITEMS:
        raise ValidationError({"configuration": "Navigation items do not match the approved schema."})
    codes = []
    for item in items:
        _exact_keys(item, ("code", "label", "path"), "Navigation items do not match the approved schema.")
        label = item["label"]
        if (
            not isinstance(item["code"], str) or NAV_CODE.fullmatch(item["code"]) is None
            or not isinstance(label, str) or not label.strip() or label != label.strip() or len(label) > 80
            or not isinstance(item["path"], str) or NAV_PATH.fullmatch(item["path"]) is None
        ):
            raise ValidationError({"configuration": "Navigation items do not match the approved schema."})
        codes.append(item["code"])
    if len(set(codes)) != len(codes):
        raise ValidationError({"configuration": "Navigation codes must be unique."})
    behavior = document["behavior"]
    _exact_keys(behavior, BEHAVIOR_FLAGS, "Configuration behavior does not match the approved schema.")
    if any(not isinstance(behavior[flag], bool) for flag in BEHAVIOR_FLAGS):
        raise ValidationError({"configuration": "Behavior settings must be boolean."})
    return deepcopy(document)


# Registered upgrades from older schema versions. Version 1 is current.
UPGRADES = {}
