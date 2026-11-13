"""Create, retire and insert Site-owned visual section templates."""
from __future__ import annotations

import copy
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction

from ..layout_contract import validate_layout, validate_layout_media
from ..models import ContentRole, Page
from ..section_template_models import (
    CURRENT_LAYOUT_SCHEMA_VERSION,
    SectionTemplate,
    SectionTemplateStatus,
)
from ..authorization import require_cms_grant
from .pages import require_pages_module, require_visual_builder_module
from .working_drafts import save_visual_draft


def _require_builder_author(actor, site_id, *, using="default"):
    require_cms_grant(actor, site_id, (ContentRole.AUTHOR,), using=using)
    require_pages_module(site_id, using=using)
    require_visual_builder_module(site_id, using=using)


def remap_section_ids(section):
    """Deep-clone a section and mint fresh IDs for every nested node/item."""

    def walk(value):
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, dict):
            next_value = {}
            for key, entry in value.items():
                next_value[key] = str(uuid.uuid4()) if key == "id" and isinstance(entry, str) else walk(entry)
            return next_value
        return value

    return walk(copy.deepcopy(section))


def create_section_template(*, site_id, actor, name, section, using="default"):
    _require_builder_author(actor, site_id, using=using)
    template = SectionTemplate(
        site_id=site_id,
        name=name,
        status=SectionTemplateStatus.ACTIVE,
        schema_version=CURRENT_LAYOUT_SCHEMA_VERSION,
        version=1,
        section=section,
        created_by=actor,
        updated_by=actor,
    )
    template.save(using=using)
    return template


def list_section_templates(*, site_id, actor, include_retired=False, using="default"):
    require_cms_grant(
        actor,
        site_id,
        (ContentRole.AUTHOR, ContentRole.REVIEWER, ContentRole.PUBLISHER),
        using=using,
    )
    require_pages_module(site_id, using=using)
    require_visual_builder_module(site_id, using=using)
    queryset = SectionTemplate.objects.using(using).filter(site_id=site_id).order_by("-updated_at", "name")
    if not include_retired:
        queryset = queryset.filter(status=SectionTemplateStatus.ACTIVE)
    return list(queryset)


def get_site_section_template(*, site_id, template_id, using="default"):
    return SectionTemplate.objects.using(using).filter(site_id=site_id, pk=template_id).first()


def retire_section_template(*, site_id, template_id, actor, using="default"):
    _require_builder_author(actor, site_id, using=using)
    template = get_site_section_template(site_id=site_id, template_id=template_id, using=using)
    if template is None:
        raise ValidationError({"template": "This section template is not available in this Site."})
    if template.status == SectionTemplateStatus.RETIRED:
        return template
    template.status = SectionTemplateStatus.RETIRED
    template.updated_by = actor
    template.save(using=using, update_fields=["status", "updated_by", "updated_at"])
    return template


def insert_section_template(
    *,
    site_id,
    page_id,
    template_id,
    actor,
    if_match,
    using="default",
):
    """Clone an ACTIVE same-Site template into a Page draft without partial writes."""
    _require_builder_author(actor, site_id, using=using)
    template = get_site_section_template(site_id=site_id, template_id=template_id, using=using)
    if template is None:
        raise ValidationError({"template": "This section template is not available in this Site."})
    if template.status != SectionTemplateStatus.ACTIVE:
        raise ValidationError({"template": "Retired section templates cannot be inserted."})
    if template.schema_version != CURRENT_LAYOUT_SCHEMA_VERSION:
        raise ValidationError({
            "schema_version": (
                "This template uses a layout schema version that is no longer current. "
                "Save a new template from a valid section."
            ),
        })

    page = Page.objects.using(using).filter(site_id=site_id, pk=page_id).first()
    if page is None:
        raise ValidationError({"page": "This Page is not available in this Site."})
    if page.status not in ("DRAFT", "UNPUBLISHED"):
        raise ValidationError({"page": "Open a working draft before inserting a section template."})

    current = page.metadata.get("visual_layout") if isinstance(page.metadata, dict) else None
    if current is None:
        base = {"schema_version": CURRENT_LAYOUT_SCHEMA_VERSION, "rows": []}
    else:
        base = copy.deepcopy(current)

    if not isinstance(base, dict) or base.get("schema_version") != CURRENT_LAYOUT_SCHEMA_VERSION:
        raise ValidationError({
            "metadata.visual_layout.schema_version": (
                "This Page uses an unsupported layout schema version."
            ),
        })
    rows = list(base.get("rows") or [])
    if len(rows) >= 50:
        raise ValidationError({"metadata.visual_layout.rows": "A layout can contain at most 50 rows."})

    cloned = remap_section_ids(template.section)
    candidate = {
        "schema_version": CURRENT_LAYOUT_SCHEMA_VERSION,
        "rows": [*rows, cloned],
    }
    # Fail before save_visual_draft mutates anything when media is unavailable.
    validated = validate_layout(candidate)
    validate_layout_media(validated, site_id=site_id)

    with transaction.atomic(using=using):
        return save_visual_draft(
            site_id=site_id,
            page_id=page_id,
            actor=actor,
            if_match=if_match,
            visual_layout=validated,
            using=using,
        )
