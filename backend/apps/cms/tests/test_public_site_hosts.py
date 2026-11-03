"""One public application, three hostnames, no cross-Site leakage.

The main Site and two college Sites share the public routes. Each request
is scoped by the trusted Host. Drafts, disabled modules, and another Site's
slug stay unpublished. Unpublishing is visible on the next read because the
public cache uses max-age=0 and must-revalidate.
"""
from copy import deepcopy
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model

from apps.api.models import Post
from apps.cms.menu_models import Menu, MenuItem
from apps.cms.models import Page
from apps.cms.services.pages import change_route
from apps.cms.tests.support import transition_with_site_role
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site


pytestmark = pytest.mark.django_db

HOMEPAGE = "/api/v1/site-context/homepage/"
PAGES = "/api/v1/site-context/pages/"
POSTS = "/api/v1/site-context/posts/"
MENUS = "/api/v1/site-context/menus/"
CONTEXT = "/api/v1/site-context/"
CACHE = "public, max-age=0, must-revalidate"


def _actor(prefix):
    return get_user_model().objects.create_user(username=f"{prefix}-{uuid4().hex[:8]}")


def _publish(record):
    for action in ("submit", "approve", "publish"):
        transition_with_site_role(record, action, _actor(action))
    record.refresh_from_db()
    return record


def _host(site):
    activate_site(site.pk)
    SiteDomain.objects.create(
        site=site, hostname=f"site-{site.pk}.uog.edu.et",
        is_primary=True, status=SiteDomain.Status.ACTIVE,
    )
    return f"site-{site.pk}.uog.edu.et"


def _enable(sites, code):
    module = Module.objects.get(code=code)
    if module.status != "IMPLEMENTED":
        module.status = "IMPLEMENTED"
    module.is_enabled = True
    module.save(update_fields=("status", "is_enabled"))
    for site in sites:
        enable_module_for_site(site.pk, module.pk)
    return module


def _present(site, display_name, theme):
    document = deepcopy(site.configuration)
    document["identity"]["display_name"] = display_name
    document["presentation"]["theme"] = theme
    site.configuration = document
    site.save(update_fields=("configuration",))


def test_main_and_two_colleges_stay_isolated_through_publish_and_module_gates(
    client, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "KEY_PREFIX": "uog",
            "KEY_FUNCTION": "apps.core.cache.make_cache_key",
        }
    }
    informatics, medicine = sites
    main = Site.objects.create(
        organization_unit=informatics.organization_unit.parent,
        code="MAIN", name="University of Gondar", is_main=True,
    )
    family = (main, informatics, medicine)
    _enable(family, "PAGES")
    posts = _enable(family, "POSTS")
    menus = _enable(family, "MENUS")
    _present(main, "University of Gondar", "institutional")
    _present(informatics, "College of Informatics", "institutional")
    _present(medicine, "College of Medicine", "high-contrast")
    hosts = {site.pk: _host(site) for site in family}

    published = (
        (main, "University of Gondar", "Main welcome", "institutional"),
        (informatics, "College of Informatics", "Informatics welcome", "institutional"),
        (medicine, "College of Medicine", "Medicine welcome", "high-contrast"),
    )
    for site, _display, title, _theme in published:
        home = Page.objects.create(
            site=site, title=title, slug="home", is_homepage=True,
            blocks=[{"type": "paragraph", "html": f"<p>{title}<script>alert(1)</script></p>"}],
            seo={"meta_title": title, "meta_description": f"{title} description"},
        )
        news = Page.objects.create(site=site, title=f"{title} news", slug="news")
        if site is informatics:
            change_route(news, slug="campus-news")
        _publish(home)
        _publish(news)
        post = Post.objects.create(
            site=site, title=f"{title} notice", slug="notice", content=f"{title} body",
        )
        _publish(post)
        header = Menu.objects.create(site=site, location="header", name=f"{title} header", is_active=True)
        footer = Menu.objects.create(site=site, location="footer", name=f"{title} footer", is_active=True)
        MenuItem.objects.create(
            menu=header, site=site, label=f"{title} header", item_type="custom", target="/",
        )
        MenuItem.objects.create(
            menu=footer, site=site, label=f"{title} footer", item_type="custom", target="/contacts",
        )
    draft = Page.objects.create(site=informatics, title="Secret draft", slug="secret-draft")

    seen = {}
    for site, display, title, theme in published:
        host = hosts[site.pk]
        context = client.get(CONTEXT, HTTP_HOST=host)
        assert context.status_code == 200
        assert context.json()["site"]["code"] == site.code
        assert context.json()["configuration"]["display_name"] == display
        assert context.json()["configuration"]["theme"] == theme
        homepage = client.get(HOMEPAGE, HTTP_HOST=host)
        assert homepage.status_code == 200
        assert homepage["Cache-Control"] == CACHE
        assert "host" in homepage["Vary"].lower()
        assert homepage.json()["title"] == title
        assert homepage.json()["site"] == site.pk
        assert homepage.json()["seo"]["meta_title"] == title
        assert "<script" not in homepage.content.decode()
        news_slug = "campus-news" if site is informatics else "news"
        news = client.get(f"{PAGES}{news_slug}/", HTTP_HOST=host)
        assert news.status_code == 200
        assert news.json()["title"] == f"{title} news"
        assert news.json()["site"] == site.pk
        notice = client.get(f"{POSTS}notice/", HTTP_HOST=host)
        assert notice.status_code == 200
        assert notice.json()["content"] == f"{title} body"
        assert notice["Cache-Control"] == CACHE
        menu = client.get(MENUS, HTTP_HOST=host)
        assert menu.status_code == 200
        assert menu.json()["site"] == site.pk
        assert menu.json()["locations"]["header"][0]["label"] == f"{title} header"
        assert menu.json()["locations"]["header"][0]["source"] == "local"
        assert menu.json()["locations"]["footer"][0]["label"] == f"{title} footer"
        seen[site.pk] = title

    assert len(set(seen.values())) == 3
    info_host = hosts[informatics.pk]
    medicine_host = hosts[medicine.pk]
    assert client.get(f"{PAGES}secret-draft/", HTTP_HOST=info_host).status_code == 404
    assert client.get(f"{PAGES}campus-news/", HTTP_HOST=medicine_host).status_code == 404
    assert client.get(f"{PAGES}news/", HTTP_HOST=medicine_host).json()["title"] == "Medicine welcome news"
    old = client.get(f"{PAGES}news/", HTTP_HOST=info_host)
    assert old.status_code == 308
    assert old["Location"].endswith("/api/v1/site-context/pages/campus-news/")
    assert old["Cache-Control"] == CACHE
    crossed = client.get(
        HOMEPAGE, HTTP_HOST=info_host, HTTP_X_FORWARDED_HOST=medicine_host,
    )
    assert crossed.json()["title"] == "Informatics welcome"
    assert client.get(HOMEPAGE, HTTP_HOST="unknown.uog.edu.et").status_code == 404

    transition_with_site_role(
        Page.objects.get(site=main, is_homepage=True), "unpublish", _actor("unpublish"),
    )
    removed = client.get(HOMEPAGE, HTTP_HOST=hosts[main.pk])
    assert removed.status_code == 404
    assert b"Main welcome" not in removed.content
    assert client.get(HOMEPAGE, HTTP_HOST=info_host).json()["title"] == "Informatics welcome"

    disable_module_for_site(medicine.pk, posts.pk)
    assert client.get(POSTS, HTTP_HOST=medicine_host).status_code == 404
    assert client.get(f"{POSTS}notice/", HTTP_HOST=info_host).status_code == 200
    disable_module_for_site(medicine.pk, menus.pk)
    assert client.get(MENUS, HTTP_HOST=medicine_host).status_code == 404
    assert client.get(MENUS, HTTP_HOST=info_host).json()["locations"]["header"][0]["label"] == "Informatics welcome header"
    pages_module = Module.objects.get(code="PAGES")
    disable_module_for_site(medicine.pk, pages_module.pk)
    assert client.get(HOMEPAGE, HTTP_HOST=medicine_host).status_code == 404
    assert client.get(f"{PAGES}news/", HTTP_HOST=medicine_host).status_code == 404
    assert Page.objects.filter(pk=draft.pk, site=informatics).exists()
    assert Post.objects.filter(site=medicine, slug="notice").exists()
