import json
from pathlib import Path
from django.core.management.base import BaseCommand,CommandError
from django.contrib.auth import get_user_model
from apps.cms.services.role_retirement import inventory,reconcile


class Command(BaseCommand):
    help="Inventory legacy CMS grants; apply only safe or explicitly reviewed decisions."

    def add_arguments(self,parser):
        parser.add_argument("--apply",action="store_true")
        parser.add_argument("--actor",type=int)
        parser.add_argument("--approvals")
        parser.add_argument("--report")

    def handle(self,*args,**options):
        rows=inventory()
        result={"inventory":rows,"unresolved":sum(row["status"]=="REVIEW_REQUIRED" for row in rows)}
        if options["apply"]:
            if not options["actor"]:
                raise CommandError("--actor is required for audited reconciliation.")
            try:
                actor=get_user_model().objects.get(pk=options["actor"])
                approvals=json.loads(Path(options["approvals"]).read_text()) if options["approvals"] else []
                result["outcomes"]=reconcile(actor=actor,approvals=approvals)
            except (ValueError,get_user_model().DoesNotExist) as exc:
                raise CommandError(str(exc)) from exc
        output=json.dumps(result,indent=2)
        if options["report"]:
            Path(options["report"]).write_text(output+"\n",encoding="utf-8")
        else:
            self.stdout.write(output)
