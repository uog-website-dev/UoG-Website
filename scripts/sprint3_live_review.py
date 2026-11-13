#!/usr/bin/env python3
"""Explicit local review-data seed and real HTTP/Keycloak/MinIO/Celery probe.

Run only through sprint3-review.py --live. No pytest clients, eager tasks,
storage doubles, JWT bypasses, or provider substitutions. Secrets stay in memory.
Only generated review users/Sites/objects are mutated. Review identities are
disabled afterwards; immutable CMS/audit evidence and review Sites are retained.
"""
import argparse
import copy
import hashlib
import io
import json
import os
import secrets
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from decouple import Config, RepositoryEnv
from django.contrib.auth import get_user_model
from django.conf import settings
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.models import ContentRole, SiteContentRoleAssignment, PublishedContentSnapshot, Page
from apps.cms.services.publication_cache import current_publication_version
from apps.media.models import MediaAsset, MediaProcessing, MediaDerivative, MediaUsage
from apps.media.storage import ObjectStorage
from apps.media.services import storage_parts
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site, disable_module_for_site
from apps.audit.models import AuditEvent
from config.celery import app as celery_app


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


class Review:
    def __init__(self, output):
        self.output = output
        self.run = datetime.now(timezone.utc).strftime("%m%d%H%M%S") + uuid.uuid4().hex[:4]
        env = Path("/repo/.env")
        self.config = Config(RepositoryEnv(str(env))) if env.exists() else Config()
        self.rows = []
        self.users = []
        self.started = datetime.now(timezone.utc).isoformat()
        self.profiles = {}
        self.seed = {"run_id": self.run, "sites": {}, "profiles": {}, "assets": []}
        self.kc_admin = None

    def http(self, method, url, *, token=None, body=None, headers=None):
        headers = dict(headers or {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            headers.setdefault("Content-Type", "application/json")
        req = Request(url, data=body, headers=headers, method=method)
        try:
            response = urlopen(req, timeout=45)
        except HTTPError as error:
            response = error
        data = response.read()
        try:
            parsed = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            parsed = None
        return response.code, dict(response.headers), parsed, data

    def token(self, username, password, client="backend-api", realm="uog"):
        fields = {"grant_type":"password", "client_id":client,"username":username,"password":password}
        if client == "backend-api":
            fields["client_secret"] = self.config("KEYCLOAK_BACKEND_API_SECRET")
        status, _, result, _ = self.http("POST", f"http://keycloak:8080/realms/{realm}/protocol/openid-connect/token",
            body=urlencode(fields).encode(), headers={"Content-Type":"application/x-www-form-urlencoded"})
        if status != 200:
            raise RuntimeError(f"Keycloak token grant failed ({status}); no credentials recorded")
        return result["access_token"]

    def api(self, method, path, actor=None, body=None, headers=None, host="localhost"):
        token = None
        if actor:
            profile = self.profiles[actor]
            if time.monotonic() > profile["expires"]:
                profile["token"] = self.token(profile["username"], profile["password"])
                profile["expires"] = time.monotonic() + 90
            token = profile["token"]
        return self.http(method, f"http://nginx{path}", token=token, body=body, headers={"Host":host, **(headers or {})})

    def expect(self, label, result, status, **actual):
        code, headers, body, raw = result
        row = {"case":label,"expected":{"http_status":status},"actual":{"http_status":code, **actual},
               "status":"PASS" if code == status else "FAIL"}
        for key in ("Cache-Control", "ETag", "X-Publication-Version", "Content-Type", "Vary"):
            if key in headers:
                row["actual"][key] = headers[key]
        self.rows.append(row)
        if code != status:
            # Error payloads may contain only application validation details; do
            # not record raw bodies/headers or authentication/provider responses.
            raise AssertionError(f"{label}: expected HTTP {status}, got {code}")
        return body

    def check(self, label, condition, **actual):
        self.rows.append({"case":label,"expected":True,"actual":actual or bool(condition),"status":"PASS" if condition else "FAIL"})
        if not condition:
            raise AssertionError(label)

    def provision(self, name, role, site, cms_role=None):
        username = f"s3-{self.run}-{name}"
        password = secrets.token_urlsafe(30)
        status, response_headers, _, _ = self.http("POST", "http://keycloak:8080/admin/realms/uog/users", token=self.kc_admin,
            body={"username":username,"enabled":True,"firstName":"Sprint3","lastName":"Review",
                  "email":f"{username}@example.invalid","emailVerified":True,
                  "credentials":[{"type":"password","value":password,"temporary":False}]})
        if status != 201:
            raise RuntimeError(f"Review identity creation failed ({status})")
        location=response_headers.get("Location","").rsplit("/",1)[-1]
        if location:
            self.users.append(str(uuid.UUID(location)))
        status, _, matches, _ = self.http("GET", "http://keycloak:8080/admin/realms/uog/users?"+urlencode({"username":username,"exact":"true"}),token=self.kc_admin)
        if status != 200 or len(matches) != 1:
            raise RuntimeError("Cannot resolve generated review identity")
        if matches[0]["id"] not in self.users:self.users.append(matches[0]["id"])
        self.profiles[name] = {"username":username,"password":password,"token":self.token(username,password),"expires":time.monotonic()+90}
        self.expect(f"{name}: real Keycloak authentication", self.api("GET","/api/me/", name),200)
        user = get_user_model().objects.get(username=username)
        UserRoleAssignment.objects.create(user=user, role=Role.objects.get(code=role), scope="SITE",site=site,organization=site.organization_unit)
        if cms_role:
            SiteContentRoleAssignment.objects.create(user=user, site=site, role=cms_role)
        self.seed["profiles"][name] = {"user_id":user.pk,"username":username,"role":role,"site_id":site.pk,"cms_role":cms_role}
        return user

    def seed_sites(self):
        self.check("Celery is not eager", not celery_app.conf.task_always_eager)
        self.check("Real Celery worker responds", bool(celery_app.control.inspect(timeout=3).ping()))
        for code in ("MEDIA","PAGES","VISUAL_BUILDER","POSTS"):
            self.check(f"{code}: existing global capability enabled", Module.objects.filter(code=code,status="IMPLEMENTED",is_enabled=True).exists())
        self.kc_admin = self.token(self.config("KC_ADMIN_USERNAME",default="uog_admin"),self.config("KC_ADMIN_PASSWORD"),client="admin-cli",realm="master")
        root = OrganizationUnit.objects.filter(parent__isnull=True,organization_type__code="UNIVERSITY").first()
        if root is None:
            raise RuntimeError("Seed the institutional university structure before review")
        kind = OrganizationType.objects.get(code="COLLEGE")
        for letter, label in (("a","Informatics"),("b","Medicine")):
            org = OrganizationUnit.objects.create(code=f"S3-{self.run}-{letter.upper()}",name=f"Sprint 3 {label} {self.run}",organization_type=kind,parent=root)
            site = Site.objects.create(code=f"S3-{self.run}-{letter.upper()}", name=f"Sprint 3 {label} {self.run}", organization_unit=org)
            for code in ("MEDIA","PAGES","VISUAL_BUILDER","POSTS"):
                enable_module_for_site(site.pk,Module.objects.get(code=code).pk)
            activate_site(site.pk)
            host = f"s3-{self.run}-{letter}.uog.local"
            SiteDomain.objects.create(site=site,hostname=host,is_primary=True,status="ACTIVE")
            self.seed["sites"][letter] = {"id":site.pk,"hostname":host,"code":site.code}
            setattr(self,letter,site)
        self.provision("admin-a","site-administrator",self.a)
        self.provision("editor-a","editor",self.a,ContentRole.AUTHOR)
        self.provision("reviewer-a","reviewer",self.a,ContentRole.REVIEWER)
        self.provision("publisher-a","publisher",self.a,ContentRole.PUBLISHER)
        self.provision("admin-b","site-administrator",self.b)
        self.provision("editor-b","editor",self.b,ContentRole.AUTHOR)
        self.provision("reviewer-b","reviewer",self.b,ContentRole.REVIEWER)
        self.provision("publisher-b","publisher",self.b,ContentRole.PUBLISHER)

    def upload(self, site, actor, payload, request_id=None, expected=202):
        return self.expect(f"{actor}: upload",self.api("POST",f"/api/v1/sites/{site.pk}/assets/upload/?filename=review.png",actor,
            body=payload,headers={"Content-Type":"image/png","Idempotency-Key":str(request_id or uuid.uuid4())}),expected)

    def wait_ready(self, site, actor, asset_id):
        deadline = time.monotonic()+100
        polls = []
        while time.monotonic()<deadline:
            result = self.api("GET",f"/api/v1/sites/{site.pk}/assets/{asset_id}/",actor)
            body = self.expect("Poll real worker state",result,200)
            polls.append({"status":body["status"],"processing_state":body["processing_state"]})
            if body["status"] == "READY" and body["processing_state"] == "READY":
                row = MediaProcessing.objects.get(asset_id=asset_id)
                self.check("Real worker produced derivatives",row.attempts>=1 and MediaDerivative.objects.filter(asset_id=asset_id).count()>=2,
                    asset_id=asset_id,attempts=row.attempts,states=polls)
                return body
            if body["processing_state"] == "FAILED":
                raise AssertionError("Worker processing failed")
            time.sleep(1)
        raise AssertionError("Real worker did not reach READY within 100 seconds")

    def layout(self, asset=None, text="Review homepage"):
        children=[{"id":"headline","type":"headline","props":{"text":text,"level":2}}]
        if asset:
            children.append({"id":"slider","type":"image_slider","props":{"items":[{"id":"slide-1","asset_id":asset,"alt":"Review campus","caption":"Review campus"}]}})
        return {"schema_version":1,"rows":[{"id":"row-1","type":"section","ratios":[60,40],"columns":[
            {"id":"column-1","type":"column","children":children},
            {"id":"column-2","type":"column","children":[
                {"id":"body","type":"editor","props":{"html":"<p>Private review content</p>"}},
                {"id":"contact","type":"contact_form","props":{"form_code":"review-contact","submit_label":"Send message"}}
            ]}]}]}

    def runtime_widgets(self, asset, page_id, page_path, host_a, host_b):
        from apps.api.models import Category
        category=Category.objects.create(site=self.a,code="REVIEW_NEWS",name="Review news",slug="review-news")
        base=f"/api/v1/sites/{self.a.pk}/posts/"
        post=self.expect("Create configured Post provider data",self.api("POST",base,"editor-a",{
            "title":"Runtime Post","slug":"runtime-post","content":"Published provider body","excerpt":"Runtime excerpt",
            "categories":[str(category.pk)],"featured_media":f"sites/{self.a.pk}/assets/{asset}"}),201)
        path=base+post["id"]+"/"
        for action,actor in (("submit","editor-a"),("approve","reviewer-a"),("publish","publisher-a")):
            token=self.api("GET",path,actor)[1]["ETag"]
            workflow=f"/api/v1/cms/sites/{self.a.pk}/content/{post['id']}/workflow/"
            self.expect(f"Post provider {action}",self.api("POST",workflow,actor,{"action":action},{"If-Match":token}),200)
        feed=self.expect("Live taxonomy-filtered Loop Grid data",self.api("GET","/api/v1/site-context/widgets/?source=posts&category=review-news&limit=4",host=host_a),200)
        self.check("Post context fields bind to published Site data",len(feed["results"])==1 and feed["results"][0]["site"]==self.a.pk
                   and feed["results"][0]["excerpt"]=="Runtime excerpt" and feed["results"][0]["featured_media"]==f"sites/{self.a.pk}/assets/{asset}")
        foreign=self.expect("Peer Site cannot resolve Loop Grid terms",self.api("GET","/api/v1/site-context/widgets/?source=posts&category=review-news",host=host_b),200)
        self.check("No foreign Post context in peer feed",foreign["results"]==[])
        terms=self.expect("Live taxonomy options",self.api("GET","/api/v1/site-context/widgets/?source=taxonomy&taxonomy_code=categories",host=host_a),200)
        self.check("Only published Site taxonomy is offered",[term["slug"] for term in terms["results"]]==["review-news"])
        self.a.refresh_from_db()
        self.a.configuration["identity"]["logo_ref"]=asset
        self.a.save(update_fields=("configuration",))
        identity=self.expect("Live Site identity binding",self.api("GET","/api/v1/site-context/widgets/?source=identity",host=host_a),200)
        self.check("Configured logo uses canonical Site asset",identity["results"][0]["logo_asset_id"]==asset)
        self.expect("Live private-original logo derivative",self.api("GET","/api/v1/site-context/identity/logo/",host=host_a),200)
        self.expect("Live private preview provider data",self.api("GET",page_path+"widget-data/?source=posts","editor-a"),200)
        request_id=str(uuid.uuid4())
        body={"request_id":request_id,"name":"Review visitor","email":"review@example.invalid","message":"Review inquiry"}
        contact=f"/api/v1/site-context/contact/{page_id}/review-contact/"
        first=self.expect("Live published Contact Form submission",self.api("POST",contact,body=body,host=host_a),202)
        replay=self.expect("Live contact receipt replay",self.api("POST",contact,body=body,host=host_a),202)
        self.check("Contact retry has one receipt",first["id"]==replay["id"])
        self.expect("Live contact email validation",self.api("POST",contact,body={**body,"request_id":str(uuid.uuid4()),"email":"invalid"},host=host_a),400)
        self.expect("Live foreign Contact Form rejection",self.api("POST",contact,body=body,host=host_b),404)

    def publish(self, site, suffix, layout):
        base=f"/api/v1/sites/{site.pk}/pages/"
        page=self.expect("Create private Page",self.api("POST",base,f"editor-{suffix}",{"title":f"S3 {self.run} {suffix}","slug":"home"}),201)
        path=base+page["id"]+"/"
        detail=self.api("GET",path+"visual-draft/",f"editor-{suffix}")
        self.expect("Load draft revision",detail,200)
        saved=self.api("PATCH",path+"visual-draft/",f"editor-{suffix}",{"visual_layout":layout},{"If-Match":detail[1]["ETag"]})
        self.expect("Save visual tree",saved,200)
        self.expect("Editor cannot approve",self.api("POST",path+"workflow/",f"editor-{suffix}",{"action":"approve"},{"If-Match":saved[1]["ETag"]}),403)
        self.expect("Submit for review",self.api("POST",path+"workflow/",f"editor-{suffix}",{"action":"submit"}),200)
        preview=self.api("GET",path+"preview/",f"reviewer-{suffix}")
        self.expect("Scoped private preview",preview,200)
        self.check("Private preview never cached","no-store" in preview[1].get("Cache-Control",""))
        approved=self.api("POST",path+"workflow/",f"reviewer-{suffix}",{"action":"approve"},{"If-Match":preview[1]["ETag"]})
        self.expect("Reviewer approves exact revision",approved,200)
        self.expect("Publisher promotes approved tree",self.api("POST",path+"workflow/",f"publisher-{suffix}",{"action":"publish"},{"If-Match":approved[1]["ETag"]}),200)
        self.expect("Site Administrator assigns root",self.api("POST",path+"homepage/",f"admin-{suffix}",{}),200)
        self.check("Immutable approval provenance",PublishedContentSnapshot.objects.filter(content_id=page["id"],approval__isnull=False,approved_revision__isnull=False).exists())
        return page["id"],path

    def execute(self):
        self.seed_sites()
        self.publish(self.b,"b",self.layout(text="Medicine remains independent"))
        hb=self.seed["sites"]["b"]["hostname"];ha=self.seed["sites"]["a"]["hostname"]
        from PIL import Image
        file=io.BytesIO();Image.new("RGB",(160,100),(25,80,160)).save(file,"PNG");payload=file.getvalue()
        # Finish Medicine fixture writes before taking its isolation baseline.
        foreign=self.upload(self.b,"editor-b",payload)
        self.seed["assets"].append(foreign["id"]);self.wait_ready(self.b,"editor-b",foreign["id"])
        medicine=self.api("GET","/api/v1/site-context/homepage/",host=hb)
        self.expect("Warm Medicine public root",medicine,200)
        request_id=uuid.uuid4()
        self.upload(self.a,"editor-a",b"\x00not an image",request_id,400)
        uploaded=self.upload(self.a,"editor-a",payload,request_id)
        asset=uploaded["id"];self.seed["assets"].append(asset)
        self.check("Upload response exposes no storage reference",not any(k in uploaded for k in ("storage_reference","bucket","key","credentials")))
        self.wait_ready(self.a,"editor-a",asset)
        stored=MediaAsset.objects.get(pk=asset)
        bucket,key=storage_parts(stored.storage_reference,self.a.pk)
        self.expect("Original MinIO object is private",self.http("GET",f"{settings.AWS_S3_ENDPOINT_URL}/{quote(bucket)}/{quote(key,safe='/')}"),403)
        replay=self.upload(self.a,"editor-a",payload,request_id)
        self.check("Retry/replay has one canonical asset",replay["id"]==asset)
        self.expect("Ready-image library selection",self.api("GET",f"/api/v1/sites/{self.a.pk}/assets/?ready_images=true","editor-a"),200)
        self.expect("Private image before publication",self.api("GET",f"/api/v1/sites/{self.a.pk}/assets/{asset}/image/","editor-a"),200)
        self.expect("Unpublished image is not public",self.api("GET",f"/api/v1/site-context/media/{asset}/",host=ha),404)
        self.expect("Foreign read denied",self.api("GET",f"/api/v1/sites/{self.b.pk}/assets/{asset}/","editor-a"),403)
        page,path=self.publish(self.a,"a",self.layout(asset))
        root=self.api("GET","/api/v1/site-context/homepage/",host=ha)
        body=self.expect("Informatics public homepage",root,200)
        self.check("Approved Slider and 60/40 order",body["metadata"]["visual_layout"]==self.layout(asset))
        self.expect("Published image through nginx",self.api("GET",f"/api/v1/site-context/media/{asset}/",host=ha),200)
        derivative=MediaDerivative.objects.get(asset_id=asset,variant="thumbnail")
        bucket,key=storage_parts(derivative.storage_reference,self.a.pk)
        ObjectStorage().delete(bucket,key)
        self.expect("Missing derivative scoped public fallback",self.api("GET",f"/api/v1/site-context/media/{asset}/?variant=thumbnail",host=ha),200)
        self.expect("Missing derivative scoped private fallback",self.api("GET",f"/api/v1/sites/{self.a.pk}/assets/{asset}/image/?variant=thumbnail","editor-a"),200)
        self.expect("Foreign public image hidden",self.api("GET",f"/api/v1/site-context/media/{asset}/",host=hb),404)
        self.expect("Published Slider asset cannot be deleted",self.api("DELETE",f"/api/v1/sites/{self.a.pk}/assets/{asset}/","admin-a"),409)
        builder=Module.objects.get(code="VISUAL_BUILDER")
        disable_module_for_site(self.a.pk,builder.pk)
        try:
            self.expect("Disabled Builder denies direct draft API",self.api("GET",path+"visual-draft/","editor-a"),400)
            self.expect("Disabling authoring preserves public root",self.api("GET","/api/v1/site-context/homepage/",host=ha),200)
        finally:
            enable_module_for_site(self.a.pk,builder.pk)
        self.expect("Reenabled Builder recovers draft API",self.api("GET",path+"visual-draft/","editor-a"),200)
        draft=self.api("POST",path+"working-draft/","editor-a",{}, {"If-Match":self.api("GET",path,"editor-a")[1]["ETag"]})
        working=self.expect("Open private working draft",draft,201)
        wd=f"/api/v1/sites/{self.a.pk}/pages/{working['id']}/visual-draft/"
        loaded=self.api("GET",wd,"editor-a");self.expect("Load racing draft",loaded,200)
        barrier=Barrier(2)
        def race(label):
            barrier.wait(timeout=10)
            return self.api("PATCH",wd,"editor-a",{"visual_layout":self.layout(asset,label)},{"If-Match":loaded[1]["ETag"]})[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(race,label) for label in ("Session A","Session B")]
            statuses=sorted(f.result(timeout=60) for f in futures)
        self.check("Real HTTP draft race has one winner",statuses==[200,409],http_statuses=statuses)
        current=self.api("GET",wd,"editor-a")
        revision=Page.objects.get(pk=working["id"]).revision_number
        self.expect("Cross-Site asset injection rejected",self.api("PATCH",wd,"editor-a",{"visual_layout":self.layout(foreign["id"])},{"If-Match":current[1]["ETag"]}),400)
        self.check("Foreign injection has no partial write",Page.objects.get(pk=working["id"]).revision_number==revision)
        unused=self.upload(self.a,"editor-a",payload)
        self.seed["assets"].append(unused["id"]);self.wait_ready(self.a,"editor-a",unused["id"])
        self.expect("Unreferenced deletion accepted",self.api("DELETE",f"/api/v1/sites/{self.a.pk}/assets/{unused['id']}/","admin-a"),202)
        deadline=time.monotonic()+60;cleanup=None
        while time.monotonic()<deadline:
            cleanup=self.api("GET",f"/api/v1/sites/{self.a.pk}/assets/{unused['id']}/deletion/","admin-a")
            if cleanup[2] and cleanup[2].get("state")=="DONE":break
            time.sleep(1)
        self.check("Real Celery reconciles deletion",bool(cleanup and cleanup[2] and cleanup[2].get("state")=="DONE"))
        after=self.api("GET","/api/v1/site-context/homepage/",host=hb)
        self.check("Medicine body and cache generation remain unchanged",digest(medicine[2])==digest(after[2]) and medicine[1].get("X-Publication-Version")==after[1].get("X-Publication-Version"))
        self.check("Published snapshot unaffected by private race",digest(root[2])==digest(self.api("GET","/api/v1/site-context/homepage/",host=ha)[2]))
        for letter,host in (("a",ha),("b",hb)):
            next_root=self.http("GET","http://nginx/",headers={"Host":host})
            self.expect(f"{letter}: nginx reaches real Next.js shell",next_root,200)
            self.check(f"{letter}: Next.js shell contains Next scripts",b"/_next/" in next_root[3])
        audit=AuditEvent.objects.filter(action="SITE_HOMEPAGE_ASSIGNED",entity_id=str(self.a.pk)).order_by("-id").first()
        self.check("Homepage audit preserves actual administrator",audit is not None and audit.actor_id==str(self.seed["profiles"]["admin-a"]["user_id"]))
        self.seed["page_a_id"]=page
        self.runtime_widgets(asset,page,path,ha,hb)
        peer=self.api("GET","/api/v1/site-context/homepage/",host=hb)
        self.check("Medicine remains independent after widget provider review",digest(medicine[2])==digest(peer[2]) and medicine[1].get("X-Publication-Version")==peer[1].get("X-Publication-Version"))

    def finish(self):
        disabled=[]
        for identifier in self.users:
            try:
                status,_,_,_=self.http("PUT",f"http://keycloak:8080/admin/realms/uog/users/{quote(identifier)}",token=self.kc_admin,body={"enabled":False})
                disabled.append(status==204)
            except Exception:
                disabled.append(False)
        local_ids=[profile["user_id"] for profile in self.seed["profiles"].values()]
        get_user_model().objects.filter(pk__in=local_ids).update(is_active=False)
        self.rows.append({"case":"Ephemeral review identities disabled","expected":True,"actual":{"created":len(self.users),"disabled":sum(disabled)},"status":"PASS" if all(disabled) else "FAIL"})


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--output",required=True);args=parser.parse_args()
    target=Path(args.output);target.mkdir(parents=True,exist_ok=True)
    review=Review(target)
    try:
        review.execute()
    except Exception as error:
        # Deliberately no traceback, HTTP request object, headers or secrets.
        detail=(": "+str(error)[:300]) if isinstance(error,(AssertionError,RuntimeError)) else ""
        review.rows.append({"case":"Live run completion","status":"FAIL","actual":type(error).__name__+detail})
    finally:
        review.finish()
    result={"run_id":review.run,"started_at_utc":review.started,"completed_at_utc":datetime.now(timezone.utc).isoformat(),"scope":"real HTTP Keycloak/Django/PostgreSQL/MinIO/Celery/nginx; Next shell only, no browser hydration claim",
            "status":"PASS" if review.rows and all(row["status"]=="PASS" for row in review.rows) else "FAIL","seed":review.seed,"checks":review.rows}
    (target/"live-services.json").write_text(json.dumps(result,indent=2,default=str)+"\n",encoding="utf-8")
    attempts=target/"attempts";attempts.mkdir(exist_ok=True)
    (attempts/f"{review.run}.json").write_text(json.dumps(result,indent=2,default=str)+"\n",encoding="utf-8")
    print(json.dumps({"run_id":review.run,"status":result["status"],"checks":len(review.rows),"failures":[row for row in review.rows if row["status"]=="FAIL"]},indent=2))
    return 0 if result["status"]=="PASS" else 1


if __name__=="__main__":
    sys.exit(main())
