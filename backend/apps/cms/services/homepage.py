"""Site configuration independent of immutable Page publication bodies."""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connection
from apps.audit.context import audit_context, current_audit_context, database_audit_context
from apps.authorization.services import permission_granted
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.models import Site
from ..models import ContentStatus, Page, PublishedContentSnapshot, Visibility
from .pages import require_pages_module
from .publication_cache import bump_publication_version


def can_assign_homepage(actor, site):
    return permission_granted(actor, "sites.update", site_id=site.pk,
                              organization_id=site.organization_unit_id, audit=False)


def assign_homepage(*, site_id, page_id, actor):
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        if not can_assign_homepage(actor, site):
            raise PermissionDenied("Site settings permission is required.")
        require_pages_module(site.pk)
        page = Page.objects.filter(pk=page_id, site_id=site.pk,
                                   status=ContentStatus.PUBLISHED,
                                   visibility__in=(Visibility.PUBLIC, Visibility.UNLISTED),
                                   draft_of__isnull=True).first()
        enabled = site.configuration.get("language", {}).get("enabled") or [site.default_language]
        if (page is None or page.locale not in enabled or
                not PublishedContentSnapshot.objects.filter(content_id=page.pk, content__site_id=site.pk).exists()):
            raise ValidationError({"homepage": "Select an eligible published Page on this Site."})
        if site.homepage_id == page.pk:
            return page
        from ..selectors.pages import homepage_of
        previous = homepage_of(site.pk)
        site.homepage_id = page.pk
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk),
                           request_id=context.request_id, ip=context.ip), database_audit_context():
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('sites.homepage_assignment', true)")
                previous_flag = cursor.fetchone()[0] or ""
                cursor.execute("SELECT set_config('sites.homepage_assignment', 'on', true)")
            try:
                site.save(update_fields=("homepage",))
            finally:
                if not connection.needs_rollback:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT set_config('sites.homepage_assignment', %s, true)", [previous_flag])
        for locale in {page.locale, previous.locale if previous else page.locale}:
            bump_publication_version(site.pk, locale, path="/")
        return page
