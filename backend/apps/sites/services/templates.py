"""Copy an approved template onto a new Site. Nothing here updates existing Sites."""
from copy import deepcopy

from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS

from ..configuration import MAX_LANGUAGES, default_configuration, merge_site_configuration, normalize_site_configuration
from ..models import Site, SiteTemplate


def configuration_for_new_site(site):
    """Use template defaults only while creating a Site that has no explicit document."""
    language = site.default_language if isinstance(site.default_language, str) else "en-us"
    if site._state.adding and site.template_id and _untouched(site.configuration, language):
        template = site.template
        if template.status == SiteTemplate.Status.ACTIVE:
            return configuration_from_template(template, default_language=language)
    return normalize_site_configuration(site.configuration, default_language=language)


def configuration_from_template(template, *, default_language):
    """Return an independent document. The template row is not modified."""
    document = deepcopy(template.default_configuration)
    enabled = list(document["language"]["enabled"])
    if default_language not in enabled:
        if len(enabled) >= MAX_LANGUAGES:
            raise ValidationError({"default_language": "The template has no room for this Site's default language."})
        enabled.append(default_language)
        document["language"] = {**document["language"], "enabled": enabled}
    return normalize_site_configuration(document, default_language=default_language)


def reject_unselectable_template(site):
    if not site.template_id:
        return
    if site.template.status == SiteTemplate.Status.ACTIVE:
        return
    if site._state.adding or not site.pk:
        raise ValidationError({"template": "An inactive template cannot be selected for a new Site."})
    current = type(site).objects.filter(pk=site.pk).values_list("template_id", flat=True).first()
    if current != site.template_id:
        raise ValidationError({"template": "An inactive template cannot be selected for a new Site."})


def provision_site(*, organization_unit, code, name, template=None, default_language="en-us", configuration=None, short_name="", is_main=False, using=DEFAULT_DB_ALIAS):
    """Create one Site and copy the selected template's defaults onto it."""
    language = default_language.strip().lower() if isinstance(default_language, str) else default_language
    if template is not None and template.status != SiteTemplate.Status.ACTIVE:
        raise ValidationError({"template": "An inactive template cannot be selected for a new Site."})
    if template is None:
        document = default_configuration(language)
    else:
        document = configuration_from_template(template, default_language=language)
    if configuration is not None:
        document = normalize_site_configuration(merge_site_configuration(document, configuration), default_language=language)
    site = Site(
        organization_unit=organization_unit, code=code, name=name, short_name=short_name,
        default_language=language, is_main=is_main, template=template, configuration=document,
    )
    site.save(using=using)
    return site


def _untouched(document, language):
    return document in ({}, default_configuration("en-us"), default_configuration(language))
