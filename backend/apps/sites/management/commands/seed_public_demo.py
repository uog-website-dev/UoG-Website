"""Provision representative local public Sites from the development fixture."""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.organizations.hierarchy_lock import hierarchy_write
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteDomain, SiteTemplate
from apps.sites.services.domains import designate_primary, domain_write
from apps.sites.services.lifecycle import transition_site
from apps.sites.services.modules import enable_module_for_site
from apps.sites.services.templates import provision_site


FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "uog-foundation.json"
CMS_MODULES = ("PAGES", "POSTS", "MENUS")
ORGANIZATIONS = (
    ("CI", "College of Informatics", "COLLEGE"),
    ("CM", "College of Medicine", "COLLEGE"),
    ("RC", "Research Center", "RESEARCH_CENTER"),
)


class Command(BaseCommand):
    help = "Create or complete the representative MAIN, Informatics, Medicine and Research Sites for local development."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("This development-only seed is available only when DEBUG=True.")

        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        with transaction.atomic(), hierarchy_write():
            root = self._root()
            units = {"UOG": root}
            for code, name, type_code in ORGANIZATIONS:
                units[code] = self._organization(code, name, type_code, root)

            templates = {row.code: row for row in SiteTemplate.objects.filter(status=SiteTemplate.Status.ACTIVE)}
            modules = {row.code: row for row in Module.objects.filter(code__in=CMS_MODULES)}
            if missing := sorted(set(CMS_MODULES) - modules.keys()):
                raise CommandError(f"Required CMS modules are missing: {', '.join(missing)}.")

            for entry in fixture["sites"]:
                self._site(entry, units, templates, modules)

        self.stdout.write(self.style.SUCCESS("Representative public Sites are ready. Configure the documented hosts file entries to open them in a browser."))

    def _root(self):
        root = OrganizationUnit.objects.filter(parent__isnull=True).select_related("organization_type").first()
        if (
            root is None or root.code != "UOG"
            or root.status != OrganizationUnit.Status.ACTIVE
            or root.organization_type.code != "UNIVERSITY"
        ):
            raise CommandError("Expected the active UOG university root; no organization records were changed.")
        return root

    def _organization(self, code, name, type_code, root):
        organization_type = OrganizationType.objects.filter(code=type_code).first()
        if organization_type is None:
            raise CommandError(f"Required active organization type {type_code} is missing.")
        unit = OrganizationUnit.objects.filter(code=code).first()
        if unit is not None:
            if unit.parent_id != root.pk or unit.organization_type_id != organization_type.pk:
                raise CommandError(f"Organization code {code} already exists with a different owner or type.")
            return unit
        return OrganizationUnit.objects.create(
            code=code, name=name, organization_type=organization_type, parent=root,
        )

    def _site(self, entry, units, templates, modules):
        site = Site.objects.filter(code=entry["code"]).first()
        if site is None:
            template = templates.get(entry["template"])
            if template is None:
                raise CommandError(f"Required active Site template {entry['template']} is missing.")
            site = provision_site(
                organization_unit=units[entry["organization_code"]], code=entry["code"],
                name=entry["name"], template=template, is_main=entry["is_main"],
                configuration=entry["configuration"],
            )
            for code in CMS_MODULES:
                enable_module_for_site(site.pk, modules[code].pk)
            self.stdout.write(f"Created {site.code}.")
        elif site.organization_unit_id != units[entry["organization_code"]].pk or site.is_main != entry["is_main"]:
            raise CommandError(f"Site code {entry['code']} already exists with a different owner or MAIN designation.")

        domain = SiteDomain.objects.filter(hostname=entry["hostname"]).first()
        if domain is not None and domain.site_id != site.pk:
            raise CommandError(f"Hostname {entry['hostname']} already belongs to another Site.")
        if domain is None:
            with domain_write():
                domain = SiteDomain.objects.create(
                    site=site, hostname=entry["hostname"], status=SiteDomain.Status.ACTIVE,
                )
        if domain.status != SiteDomain.Status.ACTIVE:
            raise CommandError(f"Fixture hostname {entry['hostname']} exists but is inactive; activate it in Domains first.")
        if not domain.is_primary:
            if site.domains.filter(is_primary=True).exists():
                raise CommandError(f"Site {site.code} already has a different primary domain; it was left unchanged.")
            designate_primary(domain.pk)

        if site.status == Site.Status.DRAFT:
            transition_site(site.pk, status=Site.Status.ACTIVE)
        self.stdout.write(f"{site.code}: http://{entry['hostname']}/")
