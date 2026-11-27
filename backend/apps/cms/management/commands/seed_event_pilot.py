"""Seed draft pilot Events on a Site for release rehearsal.

Usage:
  python manage.py seed_event_pilot --site-code MAIN
  python manage.py seed_event_pilot --site-id 12 --publish
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.cms.event_domain import event_etag, publish_event
from apps.cms.event_models import EventStatus
from apps.cms.event_pilot import SEMINAR_SLUG, SYMPOSIUM_SLUG, seed_site_pilots
from apps.sites.events import EVENTS_MODULE_CODE
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available


class Command(BaseCommand):
    help = "Seed seminar + multi-day symposium pilot drafts for Event release validation."

    def add_arguments(self, parser):
        parser.add_argument("--site-id", type=int)
        parser.add_argument("--site-code", type=str)
        parser.add_argument("--actor-username", type=str, default="")
        parser.add_argument("--publish", action="store_true", help="Publish both pilots after seed.")
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing pilot slugs on the Site before seeding.",
        )

    def handle(self, *args, **options):
        site = self._site(options)
        if not module_is_available(site.pk, EVENTS_MODULE_CODE):
            raise CommandError(f"EVENTS is not enabled for Site {site.code}.")
        actor = self._actor(options)
        if options["replace"]:
            removed, _ = site.events.filter(slug__in=[SEMINAR_SLUG, SYMPOSIUM_SLUG]).delete()
            self.stdout.write(f"Removed {removed} existing pilot row(s).")
        elif site.events.filter(slug__in=[SEMINAR_SLUG, SYMPOSIUM_SLUG]).exists():
            raise CommandError(
                "Pilot slugs already exist. Pass --replace to recreate, or choose another Site."
            )
        pilots = seed_site_pilots(site, actor=actor)
        if options["publish"]:
            if actor is None:
                raise CommandError("--publish requires --actor-username.")
            for bundle in pilots.values():
                event = bundle["event"]
                publish_event(event, actor=actor, expected=event_etag(event))
                event.refresh_from_db()
                assert event.status == EventStatus.PUBLISHED
        self.stdout.write(self.style.SUCCESS(
            f"Seeded pilots on {site.code}: {[bundle['event'].slug for bundle in pilots.values()]}"
        ))

    def _site(self, options) -> Site:
        if options.get("site_id"):
            try:
                return Site.objects.get(pk=options["site_id"])
            except Site.DoesNotExist as error:
                raise CommandError("Site id was not found.") from error
        code = (options.get("site_code") or "").strip()
        if not code:
            raise CommandError("Provide --site-id or --site-code.")
        try:
            return Site.objects.get(code=code)
        except Site.DoesNotExist as error:
            raise CommandError(f"Site code {code!r} was not found.") from error

    def _actor(self, options):
        username = (options.get("actor_username") or "").strip()
        if not username:
            return None
        User = get_user_model()
        try:
            return User.objects.get(username=username)
        except User.DoesNotExist as error:
            raise CommandError(f"User {username!r} was not found.") from error
