"""Central Site-scoped authorization for Event Management.

Every management mutation and private read uses the Site Administrator role
(`sites.update` on the Site) plus the EVENTS module gate. No Event-specific
management roles exist. Nested child loaders always bind to the parent Event
and Site so cross-Site identifier substitution fails closed.
"""
from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.cms.event_domain import public_events_for_site, require_events_admin
from apps.cms.event_models import Event
from apps.sites.events import EVENTS_MODULE_CODE
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available


def require_events_module(site: Site) -> None:
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")


def load_site(site_pk: int) -> Site:
    site = get_object_or_404(Site, pk=site_pk)
    require_events_module(site)
    return site


def admin_event(request, site_pk, event_id) -> tuple[Site, Event]:
    """Authorize Site Admin + EVENTS and load an Event owned by that Site."""
    site = load_site(site_pk)
    require_events_admin(request.user, site)
    event = get_object_or_404(Event, pk=event_id, site_id=site.pk)
    return site, event


def admin_event_only(request, site_pk, event_id) -> Event:
    return admin_event(request, site_pk, event_id)[1]


def public_event(request, slug) -> Event:
    """Host-resolved public Event. Draft/foreign private rows are not disclosed."""
    site = getattr(request, "site", None)
    if site is None or not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise NotFound("Events are not available for this Site.")
    rows = public_events_for_site(site).filter(slug=slug)
    event = rows.filter(site_id=site.pk).first() or rows.first()
    if event is None:
        raise NotFound("Event not found.")
    return event


def owned_child(model, *, pk, event: Event, **extra):
    """Load a nested row that must belong to the authorized Event.

    When the model has a site FK, also bind site_id so foreign Site IDs cannot
    ride along via parent-child substitution.
    """
    filters = {"pk": pk, "event_id": event.pk, **extra}
    field_names = {f.name for f in model._meta.fields}
    if "site" in field_names:
        filters.setdefault("site_id", event.site_id)
    return get_object_or_404(model, **filters)
