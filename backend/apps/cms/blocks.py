"""Versioned structured-content blocks shared by every content type.

Pages and Posts carry the same ordered list of blocks on the shared
``SiteContent`` record (``blocks`` + ``blocks_version``), so the schema,
its validation and its safe-rendering contract exist exactly once.

Safety model
------------
Rich text (the ``paragraph`` block) is sanitized **on write** with nh3
(Rust bindings to ammonia): the stored fragment already carries no
executable content, so no renderer can be tricked into serving one. Every
other payload field is plain text — headings, list items, labels and alt
text are *not* HTML and rendering layers must treat them as character data.
Image references are scope-checked grammar strings (the owning Site or the
platform-shared scope), never arbitrary URLs: content cannot embed images
served from another Site's media.

Database backstop (blocks_sql.py, ``cms_validate_blocks``) repeats the
envelope rules — array of objects, known types, per-block and total sizes —
for writers that bypass the domain. Payload-level rules stay in the domain
because a SQL rewrite of every type's grammar would be a second schema.

See docs/architecture/cms-content-blocks.md for the documented schemas.
"""
import json
import re
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError

import nh3

#: The schema this code validates. A record stores the version it was
#: written with; future schema versions add new validators and migrate the
#: stored payload, and this registry grows to accept them.
SCHEMA_VERSION = "1"
SUPPORTED_SCHEMA_VERSIONS = frozenset({"1"})

MAX_BLOCKS = 100
MAX_BLOCK_BYTES = 12_288        # per block, serialized JSON
MAX_BLOCKS_BYTES = 262_144      # the whole ordered list, serialized JSON

MAX_RICH_TEXT = 20_000
MAX_TEXT = 400                  # heading text
MAX_LABEL = 200                 # button label
MAX_HREF = 2_000
MAX_REF = 512                   # image references (same ceiling as seo og_image_ref)
MAX_ALT = 255
MAX_LIST_ITEMS = 50
MAX_LIST_ITEM_TEXT = 1_200

#: section is the one container; its children are non-container blocks, so
#: nesting depth is structurally bounded to two levels.
CONTAINER_TYPES = frozenset({"section"})
KNOWN_TYPES = frozenset({
    "heading", "paragraph", "image", "button", "list", "section",
})

_REF_SEGMENT = re.compile(r"\A[a-z0-9][a-z0-9._-]*\Z")
NOT_A_STRING = "must be a string"
HREF_SCHEMES = ("http", "https", "mailto")

_RICH_TEXT_TAGS = frozenset({
    "a", "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
})
_RICH_TEXT_ATTRIBUTES = {"a": frozenset({"href", "title"})}


class Rejection(Exception):
    """A reference/link policy rejection carrying its message."""


def sanitize_rich_text(html):
    """Reduce an HTML fragment to the allowlisted inline subset.

    ``script``/``style`` content is removed *with its contents*; other
    unknown tags are unwrapped to their text. Anchors keep ``href``/``title``
    only, restricted to http/https/mailto and site-internal paths, and every
    anchor gains ``rel="noopener noreferrer"``.
    """
    return nh3.clean(
        html,
        tags=_RICH_TEXT_TAGS,
        clean_content_tags={"script", "style"},
        attributes=_RICH_TEXT_ATTRIBUTES,
        attribute_filter=_filter_rich_text_attribute,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
    )


def _filter_rich_text_attribute(tag, attribute, value):
    if tag == "a" and attribute == "href":
        try:
            return check_href(value)
        except Rejection:
            return None
    return value


def check_href(href):
    """Return a normalized href, or raise ``Rejection``.

    Allowed: root-absolute site paths (``/about``, ``/about#team``) and
    http/https/mailto URLs. Anything else — protocol-relative //host,
    javascript:, data:, whitespace or control characters — is rejected,
    never a broken-but-served link.
    """
    if not isinstance(href, str):
        raise Rejection("href must be a string.")
    candidate = href.strip()
    if not candidate or len(candidate) > MAX_HREF:
        raise Rejection(f"href must be 1-{MAX_HREF} characters long.")
    if "\\" in candidate:
        raise Rejection("href must not contain backslashes.")
    if any(character.isspace() or ord(character) < 32 or ord(character) == 127
           for character in candidate):
        raise Rejection("href must not contain whitespace or control characters.")
    if candidate.startswith("/"):
        if candidate.startswith("//"):
            raise Rejection(
                "href must not be protocol-relative; use an http(s) URL "
                "or a site path."
            )
        return candidate
    try:
        parts = urlsplit(candidate)
    except ValueError as error:
        raise Rejection("href must be a valid URL.") from error
    if parts.scheme not in HREF_SCHEMES:
        raise Rejection(
            "href must be an http(s) or mailto URL, or a site path "
            "starting with '/'."
        )
    if parts.scheme == "mailto" and not parts.path:
        raise Rejection("mailto href must include a recipient.")
    if parts.scheme != "mailto" and not parts.netloc:
        raise Rejection("href must include the destination host.")
    return candidate


def check_image_ref(ref, *, site_id):
    """Return a normalized image reference, or raise ``Rejection``.

    Grammar: ``sites/<owning-site-id>/<segment>[/<segment>…]`` or
    ``shared/<segment>[/<segment>…]``. A reference into another Site's
    scope is rejected even if the file might exist there, so content can
    never display another Site's media. Existence/authorization against
    the upload service is a later story; this check is the scope
    authorization half of the contract.
    """
    if not isinstance(ref, str):
        raise Rejection("ref must be a string.")
    reference = ref.strip().lower().strip("/")
    if not reference or len(reference) > MAX_REF:
        raise Rejection(f"ref must be 1-{MAX_REF} characters long.")
    if "\\" in reference:
        raise Rejection("ref must not contain backslashes.")
    raw_segments = reference.split("/")
    if "" in raw_segments:
        raise Rejection("ref must not contain empty path segments.")
    if len(raw_segments) < 2:
        raise Rejection(
            "ref must belong to the shared scope or to this content's "
            "own Site scope."
        )
    root, scope, *tail = raw_segments
    if root == "shared":
        pass
    elif root == "sites":
        if not scope.isdigit():
            raise Rejection(
                "ref must address the Site by its numeric id: sites/<site-id>/…"
            )
        if site_id is None or int(scope) != int(site_id):
            raise Rejection("ref may only address this content's own Site scope.")
        if not tail:
            raise Rejection(
                "ref must have at least one path segment after the Site id."
            )
    else:
        raise Rejection(
            "ref must belong to the shared scope or to this content's "
            "own Site scope."
        )
    for segment in (scope, *tail):
        if segment in {".", ".."}:
            raise Rejection("ref must not contain path-traversal segments.")
        if not _REF_SEGMENT.match(segment):
            raise Rejection(
                "ref segments must be lowercase letters, digits, dots, "
                "underscores or hyphens."
            )
    return "/".join((root, scope, *tail))


def block_key(prefix, index):
    """The per-block, field-level error key (``blocks[2]``)."""
    return f"{prefix}[{index}]"


def _reject(errors, key, message):
    errors.setdefault(key, []).append(message)


def _plain_text(value, key, errors, *, ceiling, label, required=True):
    """Plain (non-HTML) text field: strip, require, ceiling."""
    if not isinstance(value, str):
        _reject(errors, key, f"{label} {NOT_A_STRING}.")
        return None
    text = value.strip()
    if not text:
        if required:
            _reject(errors, key, f"{label} must not be empty.")
            return None
        return ""
    if len(text) > ceiling:
        _reject(errors, key, f"{label} must be at most {ceiling} characters.")
        return None
    return text


def _clean_keys(block, expected, key, errors, *, required=None):
    """Reject unknown keys and report missing required ones."""
    required = expected if required is None else required
    payload_keys = set(block) - {"type"}
    unknown = sorted(payload_keys - expected)
    if unknown:
        for extra in unknown:
            _reject(errors, f"{key}.{extra}", "Unsupported block field.")
        for extra in unknown:
            block.pop(extra, None)
    missing = sorted(required - payload_keys)
    if missing:
        for name in missing:
            _reject(errors, f"{key}.{name}", "This field is required.")


def _clean_heading(block, key, errors):
    _clean_keys(block, {"level", "text"}, key, errors)
    cleaned = {}
    level = block.get("level")
    if level not in (2, 3, 4):
        _reject(
            errors, f"{key}.level",
            "level must be 2, 3 or 4 (the page title is the document's h1).",
        )
    else:
        cleaned["level"] = level
    text = _plain_text(
        block.get("text"), f"{key}.text", errors,
        ceiling=MAX_TEXT, label="text",
    )
    if text is not None:
        cleaned["text"] = text
    return cleaned or None


def _clean_paragraph(block, key, errors):
    _clean_keys(block, {"html"}, key, errors)
    html = block.get("html")
    if not isinstance(html, str):
        _reject(errors, f"{key}.html", "html must be a string.")
        return None
    if len(html) > MAX_RICH_TEXT:
        _reject(
            errors, f"{key}.html",
            f"html must be at most {MAX_RICH_TEXT} characters.",
        )
        return None
    cleaned = sanitize_rich_text(html).strip()
    if not cleaned:
        _reject(errors, f"{key}.html", "html is empty after sanitization.")
        return None
    return {"html": cleaned}


def _clean_image(block, key, errors, *, site_id):
    _clean_keys(block, {"ref", "alt", "caption"}, key, errors, required={"ref", "alt"})
    cleaned = {}
    try:
        cleaned["ref"] = check_image_ref(block.get("ref"), site_id=site_id)
    except Rejection as rejection:
        _reject(errors, f"{key}.ref", str(rejection))
    alt = _plain_text(
        block.get("alt"), f"{key}.alt", errors,
        ceiling=MAX_ALT, label="alt",
    )
    if alt is not None:
        cleaned["alt"] = alt
    if "caption" in block:
        caption = _plain_text(
            block.get("caption"), f"{key}.caption", errors,
            ceiling=MAX_TEXT, label="caption",
        )
        if caption is not None:
            cleaned["caption"] = caption
    return cleaned if "ref" in cleaned and "alt" in cleaned else None


def _clean_button(block, key, errors):
    _clean_keys(block, {"label", "href", "new_tab"}, key, errors, required={"label", "href"})
    cleaned = {}
    label = _plain_text(
        block.get("label"), f"{key}.label", errors,
        ceiling=MAX_LABEL, label="label",
    )
    if label is not None:
        cleaned["label"] = label
    try:
        cleaned["href"] = check_href(block.get("href"))
    except Rejection as rejection:
        _reject(errors, f"{key}.href", str(rejection))
    new_tab = block.get("new_tab", False)
    if not isinstance(new_tab, bool):
        _reject(errors, f"{key}.new_tab", "new_tab must be true or false.")
    elif new_tab:
        cleaned["new_tab"] = True
    return cleaned if "label" in cleaned and "href" in cleaned else None


def _clean_list(block, key, errors):
    _clean_keys(block, {"style", "items"}, key, errors)
    cleaned = {}
    style = block.get("style")
    if style not in ("ordered", "unordered"):
        _reject(errors, f"{key}.style", "style must be 'ordered' or 'unordered'.")
    else:
        cleaned["style"] = style
    items = block.get("items")
    if not isinstance(items, list):
        _reject(errors, f"{key}.items", "items must be a list of strings.")
        return None
    if not 1 <= len(items) <= MAX_LIST_ITEMS:
        _reject(
            errors, f"{key}.items",
            f"items must contain 1-{MAX_LIST_ITEMS} entries.",
        )
        return None
    cleaned_items = []
    for position, item in enumerate(items):
        item_key = f"{key}.items[{position}]"
        if not isinstance(item, str):
            _reject(errors, item_key, "item must be a string.")
            continue
        text = item.strip()
        if not text:
            _reject(errors, item_key, "item must not be empty.")
            continue
        if len(text) > MAX_LIST_ITEM_TEXT:
            _reject(
                errors, item_key,
                f"item must be at most {MAX_LIST_ITEM_TEXT} characters.",
            )
            continue
        cleaned_items.append(text)
    if len(cleaned_items) != len(items):
        return None
    cleaned["items"] = cleaned_items
    return cleaned


def _clean_section(block, key, errors, *, site_id):
    _clean_keys(block, {"heading", "children"}, key, errors, required={"children"})
    cleaned = {}
    if "heading" in block:
        heading = _plain_text(
            block.get("heading"), f"{key}.heading", errors,
            ceiling=MAX_TEXT, label="heading",
        )
        if heading is not None:
            cleaned["heading"] = heading
    children = block.get("children")
    if not isinstance(children, list) or not 1 <= len(children) <= MAX_BLOCKS:
        _reject(
            errors, f"{key}.children",
            f"children must contain 1-{MAX_BLOCKS} content blocks.",
        )
        return None
    if any(
        isinstance(child, dict) and child.get("type") in CONTAINER_TYPES
        for child in children
    ):
        _reject(
            errors, f"{key}.children",
            "sections cannot nest sections; a section's children are "
            "content blocks only.",
        )
    cleaned_children = _clean_block_list(
        children, errors, site_id=site_id, prefix=f"{key}.children",
    )
    if not cleaned_children:
        return None
    cleaned["children"] = cleaned_children
    return cleaned


def _clean_one_block(block, *, errors, site_id, key):
    """Validate one block dict; returns its normalized copy or None."""
    if not isinstance(block, dict):
        _reject(errors, key, "block must be a JSON object.")
        return None
    block = dict(block)  # a copy: the caller's input list is not mutated
    block_type = block.get("type")
    if not isinstance(block_type, str):
        _reject(errors, key, "type must be a string.")
        return None
    if block_type not in KNOWN_TYPES:
        _reject(
            errors, key,
            "Unknown block type: " + repr(block_type)
            + ". Supported: " + ", ".join(sorted(KNOWN_TYPES)) + ".",
        )
        return None
    if block_type == "image":
        cleaned = _clean_image(block, key, errors, site_id=site_id)
    elif block_type == "section":
        cleaned = _clean_section(block, key, errors, site_id=site_id)
    elif block_type == "button":
        cleaned = _clean_button(block, key, errors)
    elif block_type == "list":
        cleaned = _clean_list(block, key, errors)
    elif block_type == "paragraph":
        cleaned = _clean_paragraph(block, key, errors)
    else:
        cleaned = _clean_heading(block, key, errors)
    if cleaned is None:
        return None
    cleaned = {"type": block_type, **cleaned}
    if _blocks_json_size(cleaned) > MAX_BLOCK_BYTES:
        _reject(errors, key, f"block exceeds {MAX_BLOCK_BYTES} bytes serialized.")
        return None
    return cleaned


def _clean_block_list(blocks, errors, *, site_id, prefix="blocks"):
    """Validate an ordered block list; returns the sanitized copy.

    Input order is semantic: positions persist and are returned
    deterministically. A section's children are validated at their own
    keys (``blocks[i].children[j]``) and may not contain containers, so
    nesting stays bounded without a depth search.
    """
    cleaned_list = []
    for index, block in enumerate(blocks):
        key = block_key(prefix, index)
        cleaned = _clean_one_block(block, errors=errors, site_id=site_id, key=key)
        if cleaned is not None:
            cleaned_list.append(cleaned)
    return cleaned_list


def _blocks_json_size(blocks):
    """Serialized size of a block payload, for the size ceilings."""
    return len(json.dumps(blocks, ensure_ascii=False).encode("utf-8"))


def validate_blocks(blocks, *, site_id):
    """Validate and normalize a block list; returns the cleaned copy.

    Raises ``ValidationError`` with per-block, field-level keys when
    anything is rejected. Order is data: the returned list preserves the
    input order exactly.
    """
    if not isinstance(blocks, list):
        raise ValidationError({
            "blocks": "blocks must be a JSON array of block objects.",
        })
    if len(blocks) > MAX_BLOCKS:
        raise ValidationError({
            "blocks": f"blocks must contain at most {MAX_BLOCKS} entries.",
        })
    errors = {}
    cleaned = _clean_block_list(blocks, errors, site_id=site_id)
    if errors:
        raise ValidationError(errors)
    if _blocks_json_size(cleaned) > MAX_BLOCKS_BYTES:
        raise ValidationError({
            "blocks": (
                f"blocks exceeds {MAX_BLOCKS_BYTES} bytes serialized."
            ),
        })
    return cleaned
