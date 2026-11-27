"""Allowlisted title-banner presentation for pages and posts.

Global defaults live under Site.configuration.presentation.banner.
Per-item overrides may be stored as metadata.title_banner on a Page or Post.
"""
from copy import deepcopy
import re

from django.core.exceptions import ValidationError

BANNER_SCOPES = frozenset({"shared", "independent"})
BANNER_BACKGROUND_TYPES = frozenset({"color", "image", "pattern"})
BANNER_PATTERNS = frozenset({
    "geometric-grid",
    "geometric-dots",
    "abstract-waves",
    "gradient-navy",
    "gradient-gold",
    "minimal-lines",
    "minimal-solid",
    # Hero-style institutional patterns (same family as Featured Image hero).
    "heritage",
    "diamonds",
    "diagonal",
    "chevron-field",
})
BANNER_HEIGHTS = frozenset({"sm", "md", "lg"})
BANNER_ALIGN = frozenset({"left", "center", "right"})
BANNER_POSITION = frozenset({"top", "center", "bottom"})
BANNER_PADDING = frozenset({"sm", "md", "lg"})
HEX_COLOR = re.compile(r"\A#[0-9a-fA-F]{6}\Z")
STYLE_KEYS = (
    "enabled",
    "background_type",
    "image_ref",
    "pattern",
    "background_color",
    "overlay_color",
    "overlay_opacity",
    "height",
    "title_color",
    "title_align",
    "content_position",
    "padding_y",
)
BANNER_KEYS = ("scope", "shared", "page", "post")


def default_banner_style():
    """Professional navy gradient default with a readable light title."""
    return {
        "enabled": True,
        "background_type": "pattern",
        "image_ref": None,
        "pattern": "gradient-navy",
        "background_color": "#003366",
        "overlay_color": "#001a33",
        "overlay_opacity": 0.35,
        "height": "md",
        "title_color": "#ffffff",
        "title_align": "left",
        "content_position": "center",
        "padding_y": "md",
    }


def default_banner():
    style = default_banner_style()
    return {
        "scope": "shared",
        "shared": deepcopy(style),
        "page": deepcopy(style),
        "post": deepcopy(style),
    }


def validate_banner_style(value, *, path="banner"):
    if not isinstance(value, dict) or set(value) != set(STYLE_KEYS):
        raise ValidationError({"configuration": f"{path} does not match the approved banner style."})
    if not isinstance(value["enabled"], bool):
        raise ValidationError({"configuration": f"{path}.enabled must be boolean."})
    if value["background_type"] not in BANNER_BACKGROUND_TYPES:
        raise ValidationError({"configuration": f"{path}.background_type is not approved."})
    image_ref = value["image_ref"]
    if image_ref is not None and (not isinstance(image_ref, str) or not image_ref.strip()):
        raise ValidationError({"configuration": f"{path}.image_ref must be null or a media key."})
    if value["pattern"] not in BANNER_PATTERNS:
        raise ValidationError({"configuration": f"{path}.pattern is not approved."})
    for key in ("background_color", "overlay_color", "title_color"):
        if not isinstance(value[key], str) or HEX_COLOR.fullmatch(value[key]) is None:
            raise ValidationError({"configuration": f"{path}.{key} must be a #RRGGBB color."})
    opacity = value["overlay_opacity"]
    if isinstance(opacity, bool) or not isinstance(opacity, (int, float)) or not 0 <= float(opacity) <= 0.85:
        raise ValidationError({"configuration": f"{path}.overlay_opacity must be between 0 and 0.85."})
    if value["height"] not in BANNER_HEIGHTS:
        raise ValidationError({"configuration": f"{path}.height is not approved."})
    if value["title_align"] not in BANNER_ALIGN:
        raise ValidationError({"configuration": f"{path}.title_align is not approved."})
    if value["content_position"] not in BANNER_POSITION:
        raise ValidationError({"configuration": f"{path}.content_position is not approved."})
    if value["padding_y"] not in BANNER_PADDING:
        raise ValidationError({"configuration": f"{path}.padding_y is not approved."})
    return {**value, "image_ref": None if image_ref is None else image_ref, "overlay_opacity": round(float(opacity), 2)}


def validate_banner(value):
    if not isinstance(value, dict) or set(value) != set(BANNER_KEYS):
        raise ValidationError({"configuration": "Configuration presentation.banner does not match the approved schema."})
    if value["scope"] not in BANNER_SCOPES:
        raise ValidationError({"configuration": "Banner scope must be shared or independent."})
    return {
        "scope": value["scope"],
        "shared": validate_banner_style(value["shared"], path="banner.shared"),
        "page": validate_banner_style(value["page"], path="banner.page"),
        "post": validate_banner_style(value["post"], path="banner.post"),
    }


def resolve_banner_style(banner, content_type):
    """Pick the effective global style for pages or posts."""
    if not isinstance(banner, dict):
        return default_banner_style()
    if banner.get("scope") == "independent" and content_type in {"page", "post"}:
        style = banner.get(content_type)
    else:
        style = banner.get("shared")
    return deepcopy(style) if isinstance(style, dict) else default_banner_style()


def public_style(style, *, image_url=None):
    """Project a stored style into the public site-context shape."""
    if not isinstance(style, dict):
        style = default_banner_style()
    return {
        "enabled": bool(style.get("enabled", True)),
        "background_type": style.get("background_type", "pattern"),
        "image_url": image_url if style.get("background_type") == "image" else None,
        "pattern": style.get("pattern", "gradient-navy"),
        "background_color": style.get("background_color", "#003366"),
        "overlay_color": style.get("overlay_color", "#001a33"),
        "overlay_opacity": float(style.get("overlay_opacity", 0.35)),
        "height": style.get("height", "md"),
        "title_color": style.get("title_color", "#ffffff"),
        "title_align": style.get("title_align", "left"),
        "content_position": style.get("content_position", "center"),
        "padding_y": style.get("padding_y", "md"),
    }


def override_from_metadata(metadata):
    """Return a validated override dict, or None to use the Site default."""
    if not isinstance(metadata, dict) or "title_banner" not in metadata:
        return None
    value = metadata["title_banner"]
    if value is None:
        return None
    if not isinstance(value, dict):
        return None
    if value.get("use_global") is True:
        return None
    # Allow a compact override that only toggles enabled, or a full style.
    if set(value.keys()) <= {"use_global", "enabled"} and "enabled" in value:
        style = default_banner_style()
        style["enabled"] = bool(value["enabled"])
        return style
    try:
        payload = {key: value.get(key, default_banner_style()[key]) for key in STYLE_KEYS}
        return validate_banner_style(payload, path="metadata.title_banner")
    except ValidationError:
        return None
