"""Replace QA Module fixtures with the University of Gondar academic structure.

Preserves operator-created College of Informatics site/domain bindings listed in
the fixture. Sites cannot be hard-deleted; QA Sites are archived and their
hostnames removed. Organization codes are immutable, so a QA university root is
renamed to UOG through a DEBUG-only maintenance path.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from apps.organizations.hierarchy_lock import hierarchy_write
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteDomain, SiteTemplate
from apps.sites.services.domains import designate_primary, domain_write
from apps.sites.services.lifecycle import archive_site, transition_site
from apps.sites.services.modules import enable_module_for_site
from apps.sites.services.templates import provision_site

FIXTURE = Path(settings.BASE_DIR) / "apps" / "organizations" / "fixtures" / "uog-academic-structure.json"
CMS_MODULES = ("PAGES", "POSTS", "MENUS", "VISUAL_BUILDER")
QA_ORG_RE = re.compile(r"\ACMMQA", re.I)
QA_SITE_RE = re.compile(r"\ACMMQA", re.I)
QA_HOST_RE = re.compile(r"\Acmmqa", re.I)


class Command(BaseCommand):
    help = "Remove QA Module organization/site/domain fixtures and seed the University of Gondar structure without modifying College of Informatics."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("This development-only seed is available only when DEBUG=True.")

        document = json.loads(FIXTURE.read_text(encoding="utf-8"))
        preserve_sites = {code.upper() for code in document.get("preserve_sites", [])}
        preserve_hosts = {host.lower() for host in document.get("preserve_hostnames", [])}
        binding = document["informatics_binding"]

        # Rename happens outside the app-role transaction so the migrate-role
        # connection does not wait on hierarchy_write locks.
        self._prepare_university_root(document["units"][0])

        with transaction.atomic(), hierarchy_write():
            root = self._load_university_root(document["units"][0])
            removed = self._purge_qa(preserve_sites, preserve_hosts)
            units = self._ensure_units(document["units"], root)
            self._bind_informatics(binding, units, preserve_sites, preserve_hosts)
            templates = {row.code: row for row in SiteTemplate.objects.filter(status=SiteTemplate.Status.ACTIVE)}
            modules = {row.code: row for row in Module.objects.filter(code__in=CMS_MODULES)}
            if missing := sorted(set(CMS_MODULES) - modules.keys()):
                raise CommandError(f"Required CMS modules are missing: {', '.join(missing)}.")
            for entry in document["sites"]:
                if entry["code"].upper() in preserve_sites:
                    continue
                self._ensure_site(entry, units, templates, modules)

        self.stdout.write(self.style.SUCCESS(
            f"University of Gondar structure is ready. Removed {removed['domains']} QA domains and archived {removed['sites']} QA Sites. "
            f"Preserved Informatics site {binding['site_code']} / {binding['hostname']}."
        ))

    def _prepare_university_root(self, root_entry):
        root = OrganizationUnit.objects.filter(parent__isnull=True).select_related("organization_type").first()
        university = OrganizationType.objects.filter(code="UNIVERSITY").first()
        if university is None:
            raise CommandError("Required organization type UNIVERSITY is missing.")
        if root is None:
            return
        if root.organization_type_id != university.pk:
            raise CommandError(f"Root organization {root.code} is not a UNIVERSITY unit.")
        if root.code == root_entry["code"]:
            return
        if not QA_ORG_RE.match(root.code) and "QA" not in root.name.upper():
            raise CommandError(
                f"Unexpected university root {root.code} ({root.name}). "
                "Refusing to replace a non-QA root automatically."
            )
        self._rename_qa_root(root.pk, root_entry["code"], root_entry["name"], root_entry.get("short_name", ""))
        self.stdout.write(f"Renamed QA university root to {root_entry['code']}.")

    def _load_university_root(self, root_entry):
        root = OrganizationUnit.objects.filter(parent__isnull=True).select_related("organization_type").first()
        university = OrganizationType.objects.filter(code="UNIVERSITY").first()
        if university is None:
            raise CommandError("Required organization type UNIVERSITY is missing.")
        if root is None:
            return OrganizationUnit.objects.create(
                code=root_entry["code"],
                name=root_entry["name"],
                short_name=root_entry.get("short_name", ""),
                organization_type=university,
                parent=None,
            )
        if root.code != root_entry["code"] or root.organization_type_id != university.pk:
            raise CommandError(f"Expected active university root {root_entry['code']}.")
        if root.name != root_entry["name"] or root.short_name != root_entry.get("short_name", root.short_name):
            root.name = root_entry["name"]
            root.short_name = root_entry.get("short_name", "")
            root.save(update_fields=["name", "short_name"])
        return root

    def _rename_qa_root(self, root_id, code, name, short_name):
        # Organization codes are immutable by product rule. Local DEBUG seed may
        # replace a generated Module QA root so the single institutional root can
        # become UOG without deleting protected Site rows. Table ownership belongs
        # to the migration role, so this path opens a one-off migrate connection.
        import os

        import psycopg

        db = settings.DATABASES["default"]
        with psycopg.connect(
            host=db["HOST"],
            port=db["PORT"],
            dbname=db["NAME"],
            user=os.environ.get("DB_MIGRATE_USER", "uog_migrate"),
            password=os.environ.get("DB_MIGRATE_PASSWORD", "uog_migrate_password"),
        ) as migrate_conn:
            migrate_conn.execute("ALTER TABLE organizations_organizationunit DISABLE TRIGGER organization_unit_immutable_code")
            try:
                result = migrate_conn.execute(
                    """
                    UPDATE organizations_organizationunit
                       SET code = %s, name = %s, short_name = %s, updated_at = NOW()
                     WHERE id = %s AND parent_id IS NULL
                    """,
                    (code, name, short_name, root_id),
                )
                if result.rowcount != 1:
                    raise CommandError("QA university root rename did not update exactly one root row.")
            finally:
                migrate_conn.execute("ALTER TABLE organizations_organizationunit ENABLE TRIGGER organization_unit_immutable_code")
            migrate_conn.commit()

    def _purge_qa(self, preserve_sites, preserve_hosts):
        qa_sites = list(Site.objects.filter(code__iregex=r"^CMMQA").exclude(code__in=preserve_sites))
        removed_domains = 0
        for site in qa_sites:
            for domain in list(site.domains.all()):
                if domain.hostname.lower() in preserve_hosts:
                    continue
                if not QA_HOST_RE.match(domain.hostname) and "qa" not in domain.hostname.lower():
                    continue
                self._remove_domain(domain)
                removed_domains += 1
            if site.status != Site.Status.ARCHIVED:
                archive_site(site.pk)
                self.stdout.write(f"Archived QA Site {site.code}.")
        orphan_domains = SiteDomain.objects.filter(hostname__iregex=r"^cmmqa").exclude(hostname__in=preserve_hosts)
        for domain in orphan_domains:
            self._remove_domain(domain)
            removed_domains += 1
        return {"sites": len(qa_sites), "domains": removed_domains}

    def _remove_domain(self, domain: SiteDomain):
        # Archived QA Sites still have a sole primary active hostname. Product
        # rules block deactivating that primary without a replacement, so local
        # DEBUG cleanup deletes the row through the migration role.
        import os

        import psycopg

        db = settings.DATABASES["default"]
        hostname = domain.hostname
        with psycopg.connect(
            host=db["HOST"],
            port=db["PORT"],
            dbname=db["NAME"],
            user=os.environ.get("DB_MIGRATE_USER", "uog_migrate"),
            password=os.environ.get("DB_MIGRATE_PASSWORD", "uog_migrate_password"),
        ) as migrate_conn:
            migrate_conn.execute("ALTER TABLE sites_sitedomain DISABLE TRIGGER USER")
            try:
                migrate_conn.execute("DELETE FROM sites_sitedomain WHERE id = %s", (domain.pk,))
            finally:
                migrate_conn.execute("ALTER TABLE sites_sitedomain ENABLE TRIGGER USER")
            migrate_conn.commit()
        self.stdout.write(f"Removed QA domain {hostname}.")

    def _ensure_units(self, entries, root):
        units = {"UOG": root}
        types = {row.code: row for row in OrganizationType.objects.all()}
        for entry in entries:
            if entry["parent_code"] is None:
                continue
            organization_type = types.get(entry["organization_type"])
            if organization_type is None:
                raise CommandError(f"Required organization type {entry['organization_type']} is missing.")
            parent = units[entry["parent_code"]]
            existing = OrganizationUnit.objects.filter(code=entry["code"]).first()
            if existing is not None:
                if existing.parent_id != parent.pk or existing.organization_type_id != organization_type.pk:
                    raise CommandError(
                        f"Organization code {entry['code']} already exists with a different parent or type."
                    )
                changed = []
                if existing.name != entry["name"]:
                    existing.name = entry["name"]; changed.append("name")
                short = entry.get("short_name", "")
                if existing.short_name != short:
                    existing.short_name = short; changed.append("short_name")
                if changed:
                    existing.save(update_fields=changed)
                units[entry["code"]] = existing
                continue
            units[entry["code"]] = OrganizationUnit.objects.create(
                code=entry["code"],
                name=entry["name"],
                short_name=entry.get("short_name", ""),
                organization_type=organization_type,
                parent=parent,
            )
            self.stdout.write(f"Created organization {entry['code']}.")
        return units

    def _bind_informatics(self, binding, units, preserve_sites, preserve_hosts):
        site = Site.objects.filter(code=binding["site_code"]).first()
        if site is None:
            raise CommandError(
                f"Preserved Informatics site {binding['site_code']} was not found. "
                "Create it first or update the fixture binding."
            )
        owner = units[binding["organization_code"]]
        if site.organization_unit_id != owner.pk:
            site.organization_unit = owner
            site.save(update_fields=["organization_unit"])
            self.stdout.write(f"Linked {site.code} to organization {owner.code} without changing Site content.")

        domain = SiteDomain.objects.filter(hostname=binding["hostname"]).first()
        if domain is None:
            raise CommandError(f"Preserved Informatics hostname {binding['hostname']} was not found.")
        if domain.site_id != site.pk:
            raise CommandError(f"Hostname {binding['hostname']} belongs to another Site; left unchanged.")
        if domain.status != SiteDomain.Status.ACTIVE:
            raise CommandError(f"Informatics hostname {binding['hostname']} is inactive; activate it manually.")
        if not domain.is_primary:
            if site.domains.filter(is_primary=True).exclude(pk=domain.pk).exists():
                self.stdout.write(f"Informatics site already has another primary domain; left {binding['hostname']} as-is.")
            else:
                designate_primary(domain.pk)
        # Defensive: never archive/delete preserved rows.
        assert site.code.upper() in preserve_sites
        assert domain.hostname.lower() in preserve_hosts

    def _ensure_site(self, entry, units, templates, modules):
        site = Site.objects.filter(code=entry["code"]).first()
        if site is None:
            template = templates.get(entry["template"])
            if template is None:
                raise CommandError(f"Required active Site template {entry['template']} is missing.")
            site = provision_site(
                organization_unit=units[entry["organization_code"]],
                code=entry["code"],
                name=entry["name"],
                template=template,
                is_main=entry["is_main"],
                configuration=entry["configuration"],
            )
            for code in CMS_MODULES:
                enable_module_for_site(site.pk, modules[code].pk)
            self.stdout.write(f"Created Site {site.code}.")
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
            raise CommandError(f"Fixture hostname {entry['hostname']} exists but is inactive.")
        if not domain.is_primary:
            if site.domains.filter(is_primary=True).exists():
                raise CommandError(f"Site {site.code} already has a different primary domain.")
            designate_primary(domain.pk)
        if site.status == Site.Status.DRAFT:
            transition_site(site.pk, status=Site.Status.ACTIVE)
        self.stdout.write(f"{site.code}: http://{entry['hostname']}/")
