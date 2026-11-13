"""Cancel abandoned provisioning; active accounts are never reconciliation targets."""
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from apps.accounts.models import AccountProfile, OIDCIdentity
from apps.accounts.site_provisioning import KeycloakAccounts
from apps.authorization.models import UserRoleAssignment
from apps.authorization.services import record_decision


class Command(BaseCommand):
    help="Reconcile stale PENDING/FAILED Site-created accounts. Dry run by default."

    def add_arguments(self,parser):
        parser.add_argument("--apply",action="store_true")
        parser.add_argument("--minimum-age-minutes",type=int,default=15)

    def handle(self,*args,**options):
        if options["minimum_age_minutes"] < 0:
            raise CommandError("Minimum age must be nonnegative.")
        cutoff=timezone.now()-timedelta(minutes=options["minimum_age_minutes"])
        candidates=AccountProfile.objects.exclude(state="ACTIVE").filter(created_at__lte=cutoff)
        count=candidates.count()
        if not options["apply"]:
            self.stdout.write(f"Dry run: {count} abandoned account(s); no changes.")
            return
        if not count:
            self.stdout.write("No abandoned accounts; active accounts preserved.")
            return
        client=KeycloakAccounts()
        for pk in list(candidates.values_list("pk",flat=True)):
            with transaction.atomic():
                profile=AccountProfile.objects.select_for_update().filter(pk=pk,created_at__lte=cutoff).exclude(state="ACTIVE").first()
                if profile is None:
                    continue
                identity=OIDCIdentity.objects.get(user_id=profile.user_id,issuer=settings.OIDC_ISSUER)
                # Delete only the recorded subject. A failed call rolls back;
                # its blocked local tombstone remains for the next attempt.
                client.remove(identity.subject)
                for assignment in UserRoleAssignment.objects.filter(user_id=profile.user_id):
                    record_decision(user=None,action="SITE_USER_PROVISIONING_RECONCILED",outcome="CHANGE",assignment=assignment)
                UserRoleAssignment.objects.filter(user_id=profile.user_id).delete()
                get_user_model().objects.get(pk=profile.user_id).delete()
        self.stdout.write(f"Reconciled {count} abandoned account(s); active accounts preserved.")
