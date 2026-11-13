"""Versioned, bounded article HTML stored in the existing revision metadata."""
from html import unescape
from uuid import UUID
import re
from html.parser import HTMLParser

import nh3
from django.core.exceptions import ValidationError

from apps.cms.blocks import _filter_rich_text_attribute

TAGS = {"p", "br", "h2", "h3", "h4", "strong", "em", "b", "i", "ul", "ol", "li", "blockquote", "a", "img"}
MAX_BYTES = 200_000
MAX_ELEMENTS = 2_000
MAX_DEPTH = 16


class ArticleMeasure(HTMLParser):
    """Measure the normalized fragment, whose markup is balanced by nh3."""

    def __init__(self):
        super().__init__()
        self.depth = 0
        self.nodes = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if tag not in {"br", "img"}:
            self.depth += 1
        if self.depth > MAX_DEPTH or self.nodes > MAX_ELEMENTS:
            raise ValidationError("Article structure exceeds the editor limits.")

    def handle_endtag(self, tag):
        if tag not in {"br", "img"}:
            self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        self.text.append(data)


def normalize_document(value):
    if not isinstance(value, dict) or set(value) != {"schema_version", "html"}:
        raise ValidationError("Use an object containing schema_version and html.")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ValidationError({"schema_version": "Only article editor version 1 is supported."})
    html = value["html"]
    if not isinstance(html, str):
        raise ValidationError({"html": "Article HTML must be a string."})
    try:
        byte_count = len(html.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise ValidationError({"html": "Article text must contain valid Unicode."}) from error
    if byte_count > MAX_BYTES:
        raise ValidationError({"html": f"Article HTML must contain at most {MAX_BYTES} UTF-8 bytes."})
    cleaned = nh3.clean(
        html,
        tags=TAGS,
        attributes={"a": {"href", "title"}, "img": {"data-asset-id", "data-node-id", "alt"}},
        clean_content_tags={"script", "style", "iframe", "object"},
        attribute_filter=lambda tag, attr, value: value if tag == "img" else _filter_rich_text_attribute(tag, attr, value),
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
    )
    # Bare pasted images carry no trusted asset identity and are discarded.
    cleaned = re.sub(r'<img\b[^>]*>', lambda match: match[0] if 'data-asset-id=' in match[0] else '', cleaned)
    article_images(cleaned)
    measure = ArticleMeasure()
    measure.feed(cleaned)
    if not unescape("".join(measure.text)).replace("\xa0", " ").strip():
        raise ValidationError({"html": "Write some article content before saving."})
    return {"schema_version": 1, "html": cleaned}


class ArticleImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []
        self.nodes = set()

    def handle_starttag(self, tag, attrs):
        if tag != "img":
            return
        values = dict(attrs)
        try:
            asset = str(UUID(values.get("data-asset-id", "")))
            node = str(UUID(values.get("data-node-id", "")))
        except (ValueError, TypeError, AttributeError) as error:
            raise ValidationError({"editor_document": "Images require valid asset and placement identifiers."}) from error
        if asset != values["data-asset-id"].lower() or node != values["data-node-id"].lower():
            raise ValidationError({"editor_document": "Use canonical UUIDs for image assets and placements."})
        alt = values.get("alt", "").strip()
        if not alt or len(alt) > 1000:
            raise ValidationError({"editor_document": "Each image needs alternative text of 1 to 1000 characters."})
        if node in self.nodes:
            raise ValidationError({"editor_document": "Image placement identifiers must be unique."})
        self.nodes.add(node)
        self.images.append((asset, node, alt))


def article_images(html):
    parser = ArticleImages()
    parser.feed(html)
    return parser.images
