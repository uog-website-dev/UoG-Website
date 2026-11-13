"""Dedicated local fixtures for the writable module browser acceptance test.

Run inside the development backend: stdin is the keycloak-init environment.
Credentials stay in a mode-0600 /tmp file. Cleanup disables only test accounts,
revokes their grants and archives only the three newly created synthetic Sites.
"""
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.authorization.models import Role, UserRoleAssignment

from apps.organizations.models import OrganizationUnit
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site, archive_site

assert settings.DEBUG, "This fixture tool is restricted to local development."
env = json.load(sys.stdin)
private = Path("/tmp/module-lifecycle-session.json")


def http(url, method="GET", body=None, token=None, form=None):
    headers = {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = urllib.parse.urlencode(form).encode() if form else json.dumps(body).encode() if body is not None else None
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status in (200, 201, 204), f"Fixture HTTP {method} failed: {response.status}"
    raw = response.read()
    return json.loads(raw) if raw else None, dict(response.headers)


def token(username, password, master=False):
    form = {"grant_type": "password", "client_id": "admin-cli" if master else "backend-api",
            "username": username, "password": password, "scope": "openid profile email"}
    if not master:
        form["client_secret"] = env["KEYCLOAK_BACKEND_API_SECRET"]
    return http("http://keycloak:8080/realms/" + ("master" if master else "uog") + "/protocol/openid-connect/token",
                "POST", form=form)[0]["access_token"]


master = token(env["KC_BOOTSTRAP_ADMIN_USERNAME"], env["KC_BOOTSTRAP_ADMIN_PASSWORD"], True)
if sys.argv[1] == "setup":
    assert not private.exists(), "Clean up the previous module lifecycle run first."
    assert Module.objects.filter(code="POSTS", is_enabled=True, status="IMPLEMENTED").exists(), "Enable POSTS in the QA environment first."
    run = "cmmqa" + uuid.uuid4().hex[:8]
    state = {"run": run, "actors": {}, "sites": [], "slug": run, "title": "Module lifecycle " + run}
    def save():
        private.touch(mode=0o600, exist_ok=True)
        private.write_text(json.dumps(state))
    save()
    platform = {"username": env["KEYCLOAK_DEV_USERNAME"], "password": env["KEYCLOAK_DEV_PASSWORD"]}
    # Reuse the existing authorized development platform account, never grant it
    # additional privileges. Provision test account permissions through the API.
    platform_token = token(**platform)
    roles = http("http://backend:8000/api/v1/authorization/roles/", token=platform_token)[0]
    roles = {r["code"]: r["id"] for r in (roles["results"] if isinstance(roles, dict) else roles)}
    state["actors"]["platform"] = platform
    owner = OrganizationUnit.objects.filter(status="ACTIVE").first()
    assert owner is not None, "Seed the development organization hierarchy before running acceptance."
    for label in ("Informatics", "Medicine", "Unselected"):
        site = Site.objects.create(organization_unit=owner, code=run.upper() + "-" + label.upper(), name=run + " " + label)
        state["sites"].append({"id": site.pk, "name": site.name, "code": site.code})
        save()
        activate_site(site.pk)
        SiteDomain.objects.create(site=site, hostname=run + "-" + label.lower() + ".uog.local", is_primary=True, status="ACTIVE")
    state["host"] = run + "-informatics.uog.local"
    for name, role in (("author", "site-administrator"), ("reviewer", "reviewer"), ("publisher", "publisher")):
        username, password = run + "-" + name, secrets.token_urlsafe(24)
        _, headers = http("http://keycloak:8080/admin/realms/uog/users", "POST", {
            "username": username, "enabled": True, "emailVerified": True, "email": username + "@example.invalid",
            "firstName": "QA", "lastName": name, "requiredActions": [],
            "credentials": [{"type": "password", "value": password, "temporary": False}],
        }, master)
        state["actors"][name] = {"username": username, "password": password, "kc_id": headers["Location"].rsplit("/", 1)[-1]}
        save()
        actor_token = token(username, password)
        state["actors"][name]["access_token"] = actor_token
        save()
        http("http://backend:8000/api/me/", token=actor_token)
        user = get_user_model().objects.get(username=username)
        for site in state["sites"][:2]:
            # Workflow roles do not include Site directory access. A scoped
            # viewer grant lets those users open their assigned workspace.
            for role_code in ([role] if name == "author" else [role, "viewer"]):
                http("http://backend:8000/api/v1/authorization/assignments/", "POST", {
                    "user": user.pk, "role": roles[role_code], "scope": "SITE", "site": site["id"], "organization": owner.pk,
                }, platform_token)

    print("Dedicated module lifecycle fixtures ready.")
elif sys.argv[1] == "cleanup":
    state = json.loads(private.read_text())
    owned = [a for a in state["actors"].values() if a.get("kc_id")]
    for actor in owned:
        assert actor["username"].startswith(state["run"] + "-")
        http("http://keycloak:8080/admin/realms/uog/users/" + actor["kc_id"], "PUT", {"enabled": False}, master)
        http("http://keycloak:8080/admin/realms/uog/users/" + actor["kc_id"] + "/logout", "POST", {}, master)
    ids = get_user_model().objects.filter(username__in=[a["username"] for a in owned]).values_list("pk", flat=True)
    UserRoleAssignment.objects.filter(user_id__in=ids, revoked_at=None).update(revoked_at=timezone.now())
    pass
    get_user_model().objects.filter(pk__in=ids).update(is_active=False)
    for item in state["sites"]:
        assert Site.objects.get(pk=item["id"]).code.startswith(state["run"].upper() + "-")
        archive_site(item["id"])
    private.unlink()
    print("QA accounts disabled, grants revoked, synthetic Sites archived; content and audit history retained.")
else:
    raise SystemExit("Choose setup or cleanup.")
