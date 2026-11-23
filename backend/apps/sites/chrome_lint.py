"""Pre-publish copy lint for Site chrome.

Policy (agreed for P4-F-CHROME): placeholder, QA/review and design-reference
wording **blocks** publication. Structural issues worth a second look (duplicate
public headings) are **warnings** and never block. Only display text is scanned;
URLs and contact values are validated by their own allowlists.

The same functions back footer and header publication, so the policy cannot
drift between the two surfaces.
"""
import re
from django.core.exceptions import ValidationError

# Wording that must never reach visitors.
PLACEHOLDER = re.compile(r"\b(?:lorem|ipsum|placeholder|tbd|todo|xxx)\b|add your|replace me|sample text|dummy text", re.I)
QA_MARKER = re.compile(r"\bq\.?a\.?\b|\bqa[-_ ]?\d{2,}\b|\breview\b|\bstaging\b|\btest site\b|internal only", re.I)
REFERENCE = re.compile(r"\breference\b|private design|design reference|used as a", re.I)

BLOCK_MESSAGES = (
    (PLACEHOLDER, "Remove placeholder text before publishing."),
    (QA_MARKER, "Remove review, QA or internal wording before publishing."),
    (REFERENCE, "Remove design-reference wording before publishing."),
)

# Display fields checked on every publication, in addition to footer columns.
FOOTER_TEXT_FIELDS = (
    "description", "links_heading", "highlight_label", "newsletter_label",
    "support_label", "copyright_text", "address",
)
HEADER_TEXT_FIELDS = ("cta_label",)


def scan_text(path, value, errors):
    if not isinstance(value, str) or not value.strip():
        return
    for pattern, message in BLOCK_MESSAGES:
        if pattern.search(value):
            errors.setdefault(path, message)
            return


def lint_footer(values):
    """Return (errors, warnings); errors block publication."""
    errors, warnings = {}, []
    columns = values.get("columns") or []
    for field in FOOTER_TEXT_FIELDS:
        scan_text(field, values.get(field), errors)
    headings = {}
    for index, column in enumerate(columns):
        if not isinstance(column, dict):
            continue
        path = f"columns.{index}"
        heading = (column.get("heading") or "").strip()
        if not heading:
            errors.setdefault(f"{path}.heading", "Add a public heading for this column.")
        else:
            scan_text(f"{path}.heading", heading, errors)
            headings.setdefault(heading.casefold(), []).append(index)
        scan_text(f"{path}.description", column.get("description"), errors)
    for heading, indexes in headings.items():
        if len(indexes) > 1:
            warnings.append({
                "path": f"columns.{indexes[1]}.heading",
                "message": f"More than one footer column is titled “{heading}”. Visitors cannot tell them apart.",
            })
    return errors, warnings


def lint_header(values):
    errors, warnings = {}, []
    for field in HEADER_TEXT_FIELDS:
        scan_text(field, values.get(field), errors)
    return errors, warnings


def lint_page(layout):
    """Structural accessibility/copy warnings for a page layout.

    Page publication is not blocked by these findings; they are recorded with
    the publication audit event so reviewers can fix them before the next
    publish. Missing alt text and a second primary heading are warnings, not
    publication blockers.
    """
    from apps.cms.layout_contract import iter_nodes
    if not isinstance(layout, dict) or not isinstance(layout.get("rows"), list):
        return []
    warnings = []
    headings = []
    for node, path in iter_nodes(layout, prefix="layout"):
        if not isinstance(node, dict):
            continue
        props = node.get("props") if isinstance(node.get("props"), dict) else {}
        if node.get("type") == "heading" and str(props.get("level", "")).casefold() in {"1", "h1"}:
            headings.append(f"{path}.props.text")
        references = []
        if node.get("type") in {"image", "hero_image"}:
            references.append((props.get("alt"), f"{path}.props.alt"))
            references.extend(
                (item.get("alt"), f"{path}.props.items[{index}].alt")
                for index, item in enumerate(props.get("items") or []) if isinstance(item, dict)
            )
        elif node.get("type") in {"image_slider", "image_grid"}:
            references.extend(
                (item.get("alt"), f"{path}.props.items[{index}].alt")
                for index, item in enumerate(props.get("items") or []) if isinstance(item, dict)
            )
        for alt, alt_path in references:
            if not isinstance(alt, str) or not alt.strip():
                warnings.append({"path": alt_path, "message": "Add alternative text for this image."})
    if len(headings) > 1:
        warnings.extend({"path": path, "message": "A page should have a single primary heading (h1)."} for path in headings[1:])
    return warnings


def enforce(errors):
    if errors:
        raise ValidationError(errors)
