"""Local-only integrated QA driver. Read Compose credentials on stdin; never log them.

Run inside the backend container after copying to /tmp. Uses actual HTTP through
Nginx and actual Keycloak tokens, not DRF's test client or mocked identity.
Creates dedicated QA accounts/data; secrets stay in a mode-0600 /tmp file until
the browser phase and must be removed/QA accounts disabled afterward.
"""
import json
import os
import sys
import secrets
import time
import uuid
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from apps.authorization.models import Role, UserRoleAssignment
from apps.organizations.models import OrganizationUnit
from apps.cms.models import Page, SiteContent
from apps.sites.models import Site, Module
from apps.audit.models import AuditEvent

assert settings.DEBUG, "This driver is restricted to the local development environment."
inputs = json.loads(__import__("sys").stdin.read())
env = inputs["kc"]
run = "qa" + uuid.uuid4().hex[:8]
events, results, actors = [], {}, {}
state = {"run": run, "build": inputs["build"], "date": inputs.get("date", "2026-11-03"), "objects": {}}
secret_path = Path("/tmp/qa-gate-session.json")


def save():
    Path("/tmp/qa-gate-requests.json").write_text(json.dumps(events, indent=2))
    Path("/tmp/qa-gate-results.json").write_text(json.dumps({"state": state, "results": results}, indent=2))


def mark(case, passed, detail):
    results.setdefault(case, []).append({"pass": bool(passed), "actual": detail})
    print(f"{case}: {'PASS' if passed else 'FAIL'} - {detail}", flush=True)
    save()


def http(url, method="GET", body=None, token=None, form=None, host=None, etag=None):
    data = urllib.parse.urlencode(form).encode() if form is not None else json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/x-www-form-urlencoded" if form is not None else "application/json"}
    if token: headers["Authorization"] = "Bearer " + token
    if host: headers["Host"] = host
    if etag: headers["If-Match"] = etag
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=45)
    except urllib.error.HTTPError as exc:
        response = exc
    raw = response.read().decode(errors="replace")
    try: value = json.loads(raw)
    except ValueError: value = {"non_json": raw[:200]}
    return response.status, value, dict(response.headers)


def api(path, method="GET", body=None, actor="admin", host="localhost", etag=None):
    token = actors[actor]["access_token"] if actor else None
    code, value, headers = http("http://nginx" + path, method, body, token, host=host, etag=etag)
    events.append({"path": path, "method": method, "host": host, "status": code,
                   "actor": actors[actor]["username"] if actor else "anonymous",
                   "actor_user_id": actors[actor]["user_id"] if actor else None,
                   "body": body, "response": value, "headers": {k:v for k,v in headers.items() if k.lower() in {"etag", "location", "x-request-id", "cache-control"}}})
    save()
    return code, value, headers


def need(path, method="GET", body=None, actor="admin", host="localhost", etag=None, expect=(200, 201)):
    result = api(path, method, body, actor, host, etag)
    if result[0] not in expect:
        raise RuntimeError(f"{method} {path} returned {result[0]}: {str(result[1])[:250]}")
    return result


def tag(path, actor="admin"):
    return need(path, actor=actor)[2]["ETag"]


def patch(path, body, actor="admin"):
    return need(path, "PATCH", body, actor, etag=tag(path, actor))


def action(path, action_name, actor="admin"):
    return need(path + action_name + "/", "POST", {}, actor, etag=tag(path, actor))


def items(value):
    return value.get("results", value) if isinstance(value, dict) else value


def execute():
    master = http("http://keycloak:8080/realms/master/protocol/openid-connect/token", "POST", form={
        "grant_type":"password", "client_id":"admin-cli", "username":env["KC_BOOTSTRAP_ADMIN_USERNAME"], "password":env["KC_BOOTSTRAP_ADMIN_PASSWORD"],
    })
    assert master[0] == 200, "Local Keycloak admin authentication failed."
    admin_token = master[1]["access_token"]
    for name in ("siteadmin", "editor", "reviewer", "publisher", "viewer", "admin"):
        username, password = f"{run}-{name}", secrets.token_urlsafe(24)
        code, _, headers = http("http://keycloak:8080/admin/realms/uog/users", "POST", {
            "username":username, "enabled":True, "emailVerified":True, "email":f"{username}@example.invalid",
            "firstName":"QA", "lastName":name, "requiredActions":[],
            "credentials":[{"type":"password", "value":password, "temporary":False}],
        }, admin_token)
        assert code == 201, "Dedicated QA identity creation failed."
        token = http("http://keycloak:8080/realms/uog/protocol/openid-connect/token", "POST", form={
            "grant_type":"password", "client_id":"backend-api", "client_secret":env["KEYCLOAK_BACKEND_API_SECRET"],
            "username":username,"password":password,"scope":"openid profile email",
        })
        assert token[0] == 200, "Dedicated QA identity token issuance failed."
        actors[name] = {**token[1], "username":username, "password":password, "kc_id": headers["Location"].rsplit("/",1)[-1], "user_id": None}
        me = need("/api/me/", actor=name)[1]
        user = get_user_model().objects.get(username=username)
        actors[name]["user_id"] = user.pk
    call_command("seed_rbac", verbosity=0)
    # The existing development platform administrator assigns the dedicated QA
    # platform role through the assignment API. This run does not insert that
    # grant through the ORM, and it does not keep the bootstrap credential.
    bootstrap = http("http://keycloak:8080/realms/uog/protocol/openid-connect/token", "POST", form={
        "grant_type":"password", "client_id":"backend-api", "client_secret":env["KEYCLOAK_BACKEND_API_SECRET"],
        "username":env["KEYCLOAK_DEV_USERNAME"], "password":env["KEYCLOAK_DEV_PASSWORD"], "scope":"openid profile email",
    })
    assert bootstrap[0] == 200, "Existing platform administrator token issuance failed."
    actors["bootstrap"] = {**bootstrap[1], "username": env["KEYCLOAK_DEV_USERNAME"], "user_id": None, "password": ""}
    roles = items(need("/api/v1/authorization/roles/", actor="bootstrap")[1])
    platform_role = next(row for row in roles if row["code"] == "platform-administrator")
    need("/api/v1/authorization/assignments/", "POST", {
        "user": actors["admin"]["user_id"], "role": platform_role["id"], "scope": "PLATFORM",
    }, actor="bootstrap")
    del actors["bootstrap"]
    secret_path.write_text(json.dumps({"run": run, "actors":actors}))
    secret_path.chmod(0o600)
    history = Path(f"/tmp/qa-gate-session-{run}.json")
    history.write_text(secret_path.read_text())
    history.chmod(0o600)
    mark("T12", True, "Six dedicated Keycloak users obtained real tokens accepted by /api/me/; browser/session checks are separate.")
    roots = OrganizationUnit.objects.filter(parent=None)
    if roots.count() == 0:
        created_root = need("/api/v1/organizations/", "POST", {
            "code": "UOG", "name": "University of Gondar", "organization_type": "UNIVERSITY",
        })[1]
        root_id = created_root["id"]
        state["fresh_root_created"] = True
    elif roots.count() == 1:
        root_id = roots.get().pk
    else:
        raise RuntimeError("More than one organization root is present.")
    state["objects"]["root_id"] = root_id
    org = need("/api/v1/organizations/", "POST", {"code":run.upper(),"name":"QA Acceptance College", "organization_type":"COLLEGE", "parent":root_id})[1]
    org_url = f"/api/v1/organizations/{org['id']}/"
    state["objects"]["organization_id"] = org["id"]
    patch(org_url, {"short_name":"QA College"})
    hierarchy = need(f"/api/v1/organizations/{root_id}/descendants/")[1]
    mark("T03", org["id"] in [row["id"] for row in items(hierarchy)], "Created/edited QA college beneath existing UNIVERSITY root and retrieved descendants over HTTP.")
    bad = api(org_url, "PATCH", {"parent":org["id"]}, etag=tag(org_url))
    mark("T04", bad[0] in (400,409), f"Self-parent mutation rejected with HTTP {bad[0]}.")
    built = []
    templates = items(need("/api/v1/site-templates/")[1])
    template = next((row for row in templates if row["status"] == "ACTIVE"), None)
    for index, owner in enumerate((root_id, org["id"])):
        code = f"{run.upper()}_{index}"
        body = {"organization_unit":owner, "code":code, "name":f"QA {'University' if index==0 else 'College'} {run}"}
        if template: body["template"] = template["id"]
        created = need("/api/v1/sites/", "POST", body)[1]
        sid, url = created["id"], f"/api/v1/sites/{created['id']}/"
        need(url+"configuration/", "PATCH", {"identity":{"display_name":body["name"]}, "presentation":{"theme":"institutional" if index==0 else "high-contrast"}}, etag=tag(url))
        action(url,"activate")
        host = f"{run}-{'main' if index==0 else 'college'}.uog.local"
        domain = need(url+"domains/", "POST", {"hostname":host, "status":"ACTIVE"})[1]
        action(url+f"domains/{domain['id']}/", "set-primary")
        alias = need(url+"domains/", "POST", {"hostname":f"alias-{host}","status":"ACTIVE"})[1]
        built.append({"id":sid,"url":url,"host":host,"code":code,"owner":owner,"domain_id":domain["id"],"alias":alias["hostname"]})
    state["sites"] = built
    save()
    mark("T06", built[0]["owner"] != built[1]["owner"], "Created two Sites with distinct owners and independent identity/theme configuration.")
    mark("T07", True, f"Both Sites activated; template selection {'used existing active template' if template else 'no active template available (selection coverage requires regression evidence)' }.")
    duplicate = api(built[1]["url"]+"domains/", "POST", {"hostname":built[0]["host"], "status":"ACTIVE"})
    mark("T08", duplicate[0] in (400,409), f"Primary domains and aliases created; cross-Site duplicate rejected with {duplicate[0]}.")
    for site in built:
        resolved = api("/api/v1/site-context/", actor=None, host=site["host"])
        mark("T09", resolved[0] == 200 and resolved[1].get("site",{}).get("id") == site["id"], f"Host {site['host']} resolves to its persisted Site; HTTP {resolved[0]}.")
    unknown = api("/api/v1/site-context/", actor=None, host=f"unknown-{run}.uog.local")
    mark("T09", unknown[0] in (400,404), f"Unknown host safely rejected with {unknown[0]}.")
    finish_workflow(built)


def finish_workflow(built):
    modules = items(need("/api/v1/modules/")[1])
    for code in ("PAGES","POSTS","MENUS"):
        module = next(row for row in modules if row["code"]==code)
        if not module["is_enabled"]:
            url = f"/api/v1/modules/{module['id']}/"
            response = api(url, "PATCH", {"is_enabled":True}, etag=tag(url))
            if response[0] != 200:
                mark("T10", False, f"Global {code} enable API returned {response[0]}. No model switch was used.")
                raise RuntimeError(f"Global {code} enable failed with {response[0]}")
            state.setdefault("restore_global_modules",{})[str(module["id"])] = False
        for site in built:
            existing = items(need(site["url"]+"modules/")[1])
            enabled = next((row for row in existing if row["module"] == module["id"]), None)
            if enabled is None:
                enabled = need(site["url"]+"modules/", "POST", {"module":module["id"]})[1]
            site.setdefault("module_ids",{})[code] = enabled["id"]
    mark("T10", True, "PAGES, POSTS and MENUS independently enabled through the global and per-Site management APIs.")
    roles = items(need("/api/v1/authorization/roles/")[1])
    role_by_code = {row["code"]:row for row in roles}
    for name, role_code in (("siteadmin","site-administrator"),("editor","editor"),("reviewer","reviewer"),("publisher","publisher"),("viewer","viewer")):
        if not UserRoleAssignment.objects.filter(user_id=actors[name]["user_id"],role_id=role_by_code[role_code]["id"],site_id=built[0]["id"],revoked_at=None).exists():
            need("/api/v1/authorization/assignments/", "POST", {"user":actors[name]["user_id"], "role":role_by_code[role_code]["id"], "scope":"SITE", "organization":built[0]["owner"], "site":built[0]["id"]})
    mark("T13", True, "Platform administrator assigned Site Administrator, Editor, Reviewer, Publisher and Viewer through real protected APIs; CMS uses those canonical memberships directly.")
    forbidden = api(built[1]["url"], actor="siteadmin")
    mark("T14", forbidden[0] in (403,404), f"Site-only administrator cannot retrieve Site B: {forbidden[0]}.")
    for name in ("editor","reviewer","viewer"):
        effective = api(f"/api/v1/authorization/assignments/users/{actors[name]['user_id']}/effective/?scope=SITE&site={built[0]['id']}")
        mark("T15", effective[0]==200, f"QA-D002: {name} effective scoped permission endpoint returned {effective[0]}.")
    pages = []
    for index, site in enumerate(built):
        actor = "editor" if index==0 else "admin"
        page = need(site["url"]+"pages/", "POST", {"title":f"QA Published {'Main' if index==0 else 'College'} {run}","slug":"qa-home", "blocks":[{"type":"paragraph","html":f"<p>QA {'MAIN' if index==0 else 'COLLEGE'} PUBLIC MARKER {run}</p>"}]}, actor)[1]
        site["page_id"] = page["id"]
        page_url = site["url"]+f"pages/{page['id']}/"
        # Home designation is server-managed in the current API. A regular
        # authenticated Page route remains the browser E2E target.
        patch(page_url, {"seo":{"meta_title":page["title"]}}, actor)
        pages.append((site,page,actor,page_url))
    mark("T18", True, "Editor created and conditionally edited a Site-owned Page; second Site has its own Page with the same slug.")
    bad = api(pages[0][3], "PATCH", {"blocks":[{"type":"unknown"}]}, "editor", etag=tag(pages[0][3],"editor"))
    mark("T19", bad[0]==400, f"Invalid structured block type rejected with {bad[0]}; regression suite covers hierarchy/slugs.")
    unauthorized = api(f"/api/v1/cms/sites/{built[0]['id']}/content/{built[0]['page_id']}/workflow/", "POST", {"action":"publish"}, "viewer")
    mark("T21", unauthorized[0] in (400,403,409), f"Viewer publication denied with {unauthorized[0]}.")
    for site,page,actor,url in pages:
        before = api("/api/v1/site-context/pages/qa-home/", actor=None, host=site["host"])
        mark("T22", before[0]==404, f"Draft Page on {site['host']} is not publicly served ({before[0]}).")
        workflow = f"/api/v1/cms/sites/{site['id']}/content/{page['id']}/workflow/"
        if actor == "admin":
            for name,role in (("reviewer","REVIEWER"),("publisher","PUBLISHER")):
                need("/api/v1/authorization/assignments/", "POST", {"user":actors[name]["user_id"],"role":role_by_code[role.lower()]["id"],"scope":"SITE","site":site["id"],"organization":site["owner"]})
        need(workflow,"POST",{"action":"submit"},actor)
        need(workflow,"POST",{"action":"approve"},"reviewer")
        need(workflow,"POST",{"action":"publish"},"publisher")
        public = need("/api/v1/site-context/pages/qa-home/", actor=None, host=site["host"])[1]
        mark("T20", public.get("status")=="PUBLISHED", f"Distinct author/reviewer/publisher completed review and published Page for {site['host']}.")
    site=built[0]
    category = need(site["url"]+"categories/","POST",{"code":"QA_NEWS","name":"QA News"},"editor")[1]
    taxonomy_tag = need(site["url"]+"tags/","POST",{"code":"QA_CAMPUS","name":"QA Campus"},"editor")[1]
    post = need(site["url"]+"posts/","POST",{"title":f"QA Post {run}","slug":"qa-news","excerpt":"QA excerpt", "content":"QA MAIN POST MARKER "+run,"categories":[category["id"]],"tags":[taxonomy_tag["id"]]},"editor")[1]
    site["post_id"]=post["id"]
    post_workflow=f"/api/v1/cms/sites/{site['id']}/content/{post['id']}/workflow/"
    for action_name,actor in (("submit","editor"),("approve","reviewer"),("publish","publisher")):
        need(post_workflow,"POST",{"action":action_name},actor)
    mark("T24", True, "Editor created a Post with category, tag and excerpt through the Post API.")
    mark("T26", SiteContent.objects.filter(pk=post["id"],status="PUBLISHED").exists(), "Post uses the shared SiteContent workflow and persisted PUBLISHED state.")
    feed = need("/api/v1/site-context/posts/",actor=None,host=site["host"])[1]
    foreign_feed = need("/api/v1/site-context/posts/",actor=None,host=built[1]["host"])[1]
    mark("T27", post["id"] in [r["id"] for r in items(feed)] and post["id"] not in [r["id"] for r in items(foreign_feed)], "Published Post appears only in the owning hostname feed.")
    menu_path=site["url"]+"menus/"
    menu = need(menu_path,"POST",{"name":"QA Header","location":"header"},"siteadmin")[1]
    menu_url=menu_path+f"{menu['id']}/"
    first = need(menu_url+"items/","POST",{"label":"QA Home","item_type":"page","page":site["page_id"]},"siteadmin",etag=tag(menu_url,"siteadmin"))[1]
    need(menu_url+"items/","POST",{"label":"QA Child","item_type":"custom","target":"/qa-home","parent":first["id"]},"siteadmin",etag=tag(menu_url,"siteadmin"))
    action(menu_url,"activate","siteadmin")
    mark("T28", True, "Site administrator created and activated a Menu with nested items using Menu-wide If-Match.")
    mark("T29", need(menu_url+"tree/",actor="siteadmin")[1].get("items") is not None, "Menu tree/location persisted; regression verifies reorder/depth/cycles.")
    navigation=need("/api/v1/site-context/menus/",actor=None,host=site["host"])[1]
    mark("T30", "QA Home" in json.dumps(navigation), "Published Page link appears in the owning Site's public menu; regression covers missing/draft links.")
    finish_tail(built)


def finish_tail(built):
    from apps.sites.models import SiteModule
    site = built[0]
    denial=api(built[1]["url"]+"pages/",actor="editor")
    mark("T16", denial[0] in (403,404), f"Site A Editor cannot read Site B Page inventory ({denial[0]}).")
    forged=api(site["url"]+"pages/not-a-uuid/",actor="editor")
    mark("T17", forged[0] in (400,404), f"Malformed record identifier rejected with {forged[0]}; regression covers expired/tampered JWTs.")
    enable_url=site["url"]+f"modules/{site['module_ids']['POSTS']}/"
    switched = api(enable_url+"disable/", "POST", {}, etag=tag(enable_url))
    if switched[0] != 200:
        mark("T11", False, f"Site module disable API returned {switched[0]}. No model switch was used.")
        raise RuntimeError(f"Site POSTS disable failed with {switched[0]}")
    off=api("/api/v1/site-context/posts/",actor=None,host=site["host"])
    mark("T11", off[0]==404 and SiteContent.objects.filter(pk=site["post_id"]).exists(), f"POSTS disabled: public feed {off[0]}, stored content retained. Browser UI check is separate.")
    switched = api(enable_url+"enable/", "POST", {}, etag=tag(enable_url))
    if switched[0] != 200:
        mark("T11", False, f"Site module re-enable API returned {switched[0]}. No model switch was used.")
        raise RuntimeError(f"Site POSTS enable failed with {switched[0]}")
    page_url = site["url"]+f"pages/{site['page_id']}/"
    before = need("/api/v1/site-context/pages/qa-home/", actor=None, host=site["host"])[1]
    direct = api(page_url, "PATCH", {"title":"QA DIRECT PUBLISHED EDIT "+run}, "editor", etag=tag(page_url,"editor"))
    opened = api(page_url+"working-draft/", "POST", {}, "editor", etag=tag(page_url,"editor"))
    if opened[0] not in (200, 201):
        mark("T23", False, f"Working draft open returned {opened[0]}. Direct published PATCH returned {direct[0]}.")
        raise RuntimeError("Working draft was not opened")
    draft_id = opened[1]["id"]
    draft_url = site["url"]+f"pages/{draft_id}/"
    revised = "QA revised "+run
    need(draft_url, "PATCH", {"title": revised}, "editor", etag=tag(draft_url,"editor"))
    during = need("/api/v1/site-context/pages/qa-home/", actor=None, host=site["host"])[1]
    draft_workflow = f"/api/v1/cms/sites/{site['id']}/content/{draft_id}/workflow/"
    need(draft_workflow, "POST", {"action":"submit"}, "editor")
    author_approve = api(draft_workflow, "POST", {"action":"approve"}, "editor")
    need(draft_workflow, "POST", {"action":"approve"}, "reviewer")
    published = need(draft_workflow, "POST", {"action":"publish"}, "publisher")
    after = need("/api/v1/site-context/pages/qa-home/", actor=None, host=site["host"])[1]
    mark("T23", direct[0]==400 and author_approve[0]==403 and during["title"]==before["title"] and after["title"]==revised and published[1].get("status")=="ARCHIVED",
         f"Direct published PATCH {direct[0]}; public title stayed {during['title']==before['title']} while the draft was edited; author approve {author_approve[0]}; reviewed publication status {published[1].get('status')}; public title is now the revision={after['title']==revised}.")
    other_category = need(built[1]["url"]+"categories/", "POST", {"code":"QA_OTHER_NEWS", "name":"Other news"})[1]
    cross = api(site["url"]+"posts/", "POST", {"title":"Cross category", "slug":"qa-cross-category", "content":"QA", "categories":[other_category["id"]]}, "editor")
    mark("T25", cross[0] in (400,403,404), f"Cross-Site taxonomy reference rejected with {cross[0]}.")
    draft_post = need(site["url"]+"posts/", "POST", {"title":"QA editable draft", "slug":"qa-edit-draft", "content":"QA draft content"}, "editor")[1]
    patch(site["url"]+f"posts/{draft_post['id']}/", {"excerpt":"Edited excerpt"}, "editor")
    mark("T24", True, "A separate draft Post was created and edited over HTTP.")
    invalid = api(site["url"]+"menus/", "POST", {}, "siteadmin")
    mark("T34", invalid[0]==400 and "request_id" in invalid[1], f"Missing fields return structured HTTP {invalid[0]} with request correlation ID.")
    xss = need(site["url"]+"pages/", "POST", {"title":"QA sanitization", "slug":"qa-sanitize", "blocks":[{"type":"paragraph","html":"<script>window.QA_XSS=1</script><p>Safe QA text</p>"}]}, "editor")[1]
    mark("T35", "<script" not in json.dumps(xss), "Real Page authoring sanitized a script payload before persistence.")
    audit=AuditEvent.objects.filter(after__site_id=site["id"]).count()
    mark("T36", audit>0, f"Shared persisted audit rows with QA Site context: {audit}.")
    security_probe(built)
    state["completed_http_workflow"]=True
    save()


def security_probe(built):
    principal = actors["viewer"]
    assert not UserRoleAssignment.objects.filter(user_id=principal["user_id"],role__code='platform-administrator',revoked_at=None).exists()
    assert not UserRoleAssignment.objects.filter(user_id=principal["user_id"],site_id=built[1]['id'],revoked_at=None).exists()
    state['security_probe']={'actor':principal['username'],'actor_user_id':principal['user_id'],'target_site':built[1]['id'],
        'database_grants':list(UserRoleAssignment.objects.filter(user_id=principal['user_id'],revoked_at=None).values('role__code','scope','organization_id','site_id')),
        'target_site_memberships':list(UserRoleAssignment.objects.filter(user_id=principal['user_id'],site_id=built[1]['id'],revoked_at=None).values_list('role__code',flat=True)),
        'temporary_realm_role':'platform-admin'}
    master = http("http://keycloak:8080/realms/master/protocol/openid-connect/token", "POST", form={"grant_type":"password", "client_id":"admin-cli", "username":env["KC_BOOTSTRAP_ADMIN_USERNAME"], "password":env["KC_BOOTSTRAP_ADMIN_PASSWORD"]})[1]["access_token"]
    role = http("http://keycloak:8080/admin/realms/uog/roles/platform-admin", token=master)[1]
    mapping = f"http://keycloak:8080/admin/realms/uog/users/{actors['viewer']['kc_id']}/role-mappings/realm"
    granted = http(mapping, "POST", [role], master)
    assert granted[0] == 204
    original = actors["viewer"]["access_token"]
    try:
        fresh = http("http://keycloak:8080/realms/uog/protocol/openid-connect/token", "POST", form={"grant_type":"password", "client_id":"backend-api", "client_secret":env["KEYCLOAK_BACKEND_API_SECRET"], "username":actors["viewer"]["username"], "password":actors["viewer"]["password"]})
        assert fresh[0] == 200
        actors["viewer"]["access_token"] = fresh[1]["access_token"]
        read = api(built[1]["url"]+"pages/", actor="viewer")
        write = api(built[1]["url"]+"pages/", "POST", {"title":"QA Unauthorized claim probe", "slug":"qa-forbidden-claim-"+uuid.uuid4().hex[:8], "blocks":[]}, "viewer")
        mark("T35", read[0] in (403,404) and write[0] in (403,404), f"QA-SEC001: Real Keycloak realm-role-only Site A viewer requested Site B Pages: GET={read[0]}, POST={write[0]}; no Site B or platform DB assignment exists.")
        mark("T16", read[0] in (403,404) and write[0] in (403,404), f"Cross-Site realm-role privilege probe: GET={read[0]}, POST={write[0]}.")
    finally:
        actors["viewer"]["access_token"] = original
        http(mapping, "DELETE", [role], master)


def extras(built):
    import base64
    from apps.cms.menu_models import Menu
    site = built[0]
    reviewer = Role.objects.get(code="reviewer")
    for target, expected in ((site, (201,)), (built[1], (403,404))):
        response = api("/api/v1/authorization/assignments/", "POST", {"user":actors["viewer"]["user_id"], "role":reviewer.pk, "scope":"SITE", "organization":target["owner"], "site":target["id"]}, "siteadmin")
        mark("T14", response[0] in expected, f"Site Administrator delegates a read-only role at Site {target['id']}: HTTP {response[0]} (expected {expected}).")
    denied = api("/api/v1/organizations/", "POST", {"name":"Must not create", "code":run.upper()+"_DENIED", "organization_type":"COLLEGE", "parent":site["owner"]}, "viewer")
    mark("T04", denied[0] in (401,403), f"Unauthorized Viewer Organization create rejected: {denied[0]}.")
    draft = Page.objects.get(site_id=site["id"],slug="qa-sanitize")
    menu = Menu.objects.get(site_id=site["id"],location="header")
    menu_url=site["url"]+f"menus/{menu.pk}/"
    need(menu_url+"items/", "POST", {"label":"QA Draft must be hidden", "item_type":"page", "page":str(draft.pk)}, "siteadmin", etag=tag(menu_url,"siteadmin"))
    public = need("/api/v1/site-context/menus/", actor=None, host=site["host"])[1]
    mark("T30", "QA Draft must be hidden" not in json.dumps(public), "Real public menu omits an active item's unpublished Page target.")
    unsafe=api(menu_url+"items/", "POST", {"label":"Unsafe", "item_type":"external", "target":"javascript:alert(1)"}, "siteadmin", etag=tag(menu_url,"siteadmin"))
    mark("T35", unsafe[0]==400, f"Unsafe script-scheme menu target rejected with {unsafe[0]}.")
    original=actors["viewer"]["access_token"]
    parts=original.split('.')
    parts[2]=('A' if parts[2][0]!='A' else 'B')+parts[2][1:]
    bad=http("http://nginx/api/me/",token='.'.join(parts),host="localhost")
    events.append({"path":"/api/me/","method":"GET","test":"tampered real JWT signature","status":bad[0],"response":bad[1]})
    mark("T17",bad[0]==401,f"Tampered real Keycloak token rejected with {bad[0]}.")
    previous=Path('/tmp/qa-gate-session.previous.json')
    if previous.exists():
        old=json.loads(previous.read_text())['actors']['admin']['access_token']
        body=json.loads(base64.urlsafe_b64decode(old.split('.')[1]+'==='))
        if body['exp']<time.time():
            expired=http('http://nginx/api/me/',token=old,host='localhost')
            events.append({'path':'/api/me/','method':'GET','test':'expired real Keycloak token','status':expired[0],'response':expired[1]})
            mark('T17',expired[0]==401,f"Expired real Keycloak token rejected with {expired[0]}.")
        else:
            state['expiry_limitation']='Original real token has not expired; expiration validation covered only by automated regression.'
    save()


def persistence(built):
    need(f"/api/v1/organizations/{state['objects']['organization_id']}/")
    for site in built:
        value=need(site['url'])[1]
        assert value['code']==site['code'] and value['organization_unit']==site['owner']
    mark('T05',True,'Organization and both Site records/ownership retrieved unchanged through HTTP after backend application restart.')


try:
    if set(sys.argv) & {"--resume","--tail","--extras","--persistence","--security"}:
        previous = json.loads(Path("/tmp/qa-gate-results.json").read_text())
        state = previous["state"]
        results = previous["results"]
        events = json.loads(Path("/tmp/qa-gate-requests.json").read_text())
        run = state["run"]
        actors.update(json.loads(secret_path.read_text())["actors"])
        for actor in actors.values():
            fresh = http("http://keycloak:8080/realms/uog/protocol/openid-connect/token", "POST", form={"grant_type":"password", "client_id":"backend-api", "client_secret":env["KEYCLOAK_BACKEND_API_SECRET"], "username":actor["username"], "password":actor["password"]})
            assert fresh[0] == 200
            actor.update(fresh[1])
        secret_path.write_text(json.dumps({"run":run,"actors":actors}))
        state.pop("workflow_error", None)
        operation = security_probe if '--security' in sys.argv else persistence if '--persistence' in sys.argv else extras if '--extras' in sys.argv else finish_tail if '--tail' in sys.argv else finish_workflow
        operation(state["sites"])
    else:
        execute()
except Exception as exc:
    state["workflow_error"] = str(exc)[:500]
    print("WORKFLOW STOPPED: " + str(exc)[:500], flush=True)
    save()
    raise SystemExit(1)
