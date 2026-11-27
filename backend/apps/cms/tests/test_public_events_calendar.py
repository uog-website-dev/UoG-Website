"""Public Events directory, calendar markers, aggregation and timezone filters."""
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.api.models import Category
from apps.cms.event_models import Event, EventStatus
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.models.event_settings import SiteEventSettings
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db
TZ = ZoneInfo("Africa/Addis_Ababa")


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _host(site, hostname):
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname=hostname, is_primary=True, status="ACTIVE")


def _published(site, **overrides):
    start = overrides.pop("starts_at", timezone.now() + timedelta(days=2))
    end = overrides.pop("ends_at", start + timedelta(hours=2))
    payload = {
        "site": site,
        "title": "Open Lecture",
        "slug": f"evt-{uuid.uuid4().hex[:8]}",
        "summary": "Public summary",
        "description": "<p>Body</p>",
        "starts_at": start,
        "ends_at": end,
        "timezone": "Africa/Addis_Ababa",
        "format": "PHYSICAL",
        "venue": "Hall",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def test_public_upcoming_past_and_on_date_filters(client, oidc, owner, settings):
    settings.DEBUG = True
    site = Site.objects.create(code="EVT-CAL", name="Calendar Site", organization_unit=owner)
    _host(site, "evt-cal.uog.edu.et")
    _enable_events(site)
    SiteEventSettings.objects.update_or_create(site=site, defaults={"timezone": "Africa/Addis_Ababa"})

    upcoming = _published(
        site,
        title="Future",
        slug="future",
        starts_at=datetime(2031, 6, 10, 10, 0, tzinfo=TZ),
        ends_at=datetime(2031, 6, 10, 12, 0, tzinfo=TZ),
    )
    multi = _published(
        site,
        title="Multi Day",
        slug="multi-day",
        starts_at=datetime(2031, 6, 10, 18, 0, tzinfo=TZ),
        ends_at=datetime(2031, 6, 12, 12, 0, tzinfo=TZ),
    )
    past = _published(
        site,
        title="Past",
        slug="past",
        starts_at=datetime(2020, 1, 1, 10, 0, tzinfo=TZ),
        ends_at=datetime(2020, 1, 1, 12, 0, tzinfo=TZ),
    )
    Event.objects.create(
        site=site, title="Draft", slug="draft", summary="x", description="<p>x</p>",
        starts_at=upcoming.starts_at, ends_at=upcoming.ends_at, timezone="Africa/Addis_Ababa",
        format="PHYSICAL", venue="Hall", status=EventStatus.DRAFT,
    )

    upcoming_list = client.get(
        "/api/v1/site-context/events/?lifecycle=directory_upcoming",
        HTTP_HOST="evt-cal.uog.edu.et",
    )
    assert upcoming_list.status_code == 200
    slugs = {row["slug"] for row in upcoming_list.json()["results"]}
    assert "future" in slugs and "multi-day" in slugs
    assert "past" not in slugs and "draft" not in slugs
    assert "organizer_email" not in upcoming_list.json()["results"][0]

    past_list = client.get(
        "/api/v1/site-context/events/?lifecycle=directory_past",
        HTTP_HOST="evt-cal.uog.edu.et",
    )
    assert {row["slug"] for row in past_list.json()["results"]} == {"past"}

    on_date = client.get(
        "/api/v1/site-context/events/?on_date=2031-06-11&lifecycle=directory_upcoming",
        HTTP_HOST="evt-cal.uog.edu.et",
    )
    assert on_date.status_code == 200
    assert [row["slug"] for row in on_date.json()["results"]] == ["multi-day"]

    calendar = client.get(
        "/api/v1/site-context/events/calendar/?year=2031&month=6",
        HTTP_HOST="evt-cal.uog.edu.et",
    )
    assert calendar.status_code == 200
    days = {row["date"]: row for row in calendar.json()["days"]}
    assert "2031-06-10" in days and "2031-06-11" in days and "2031-06-12" in days
    assert days["2031-06-10"]["count"] == 2
    assert str(multi.pk) in days["2031-06-11"]["event_ids"]
    assert str(past.pk) not in str(calendar.json())


def test_main_aggregation_eligible_published_only(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    from apps.organizations.models import OrganizationType, OrganizationUnit
    root = owner.parent
    college_type = OrganizationType.objects.get(code="COLLEGE")
    college = OrganizationUnit.objects.create(
        code=f"COL-{uuid.uuid4().hex[:6]}", name="College", parent=root,
        organization_type=college_type,
    )
    main = Site.objects.create(code="EVT-MAIN", name="University Main", organization_unit=root, is_main=True)
    college_site = Site.objects.create(code="EVT-COL", name="College Site", organization_unit=college)
    other = Site.objects.create(code="EVT-OTH", name="Other College", organization_unit=college)
    _host(main, "main-events.uog.edu.et")
    _host(college_site, "college-events.uog.edu.et")
    _enable_events(main)
    _enable_events(college_site)
    _enable_events(other)
    SiteEventSettings.objects.update_or_create(
        site=college_site, defaults={"public_aggregation_eligible": True},
    )
    SiteEventSettings.objects.update_or_create(
        site=other, defaults={"public_aggregation_eligible": False},
    )

    local = _published(main, title="Main Event", slug="main-event")
    eligible = _published(college_site, title="College Event", slug="college-event")
    _published(other, title="Hidden College", slug="hidden-college")
    _published(college_site, title="College Draftish", slug="college-cancelled", status=EventStatus.CANCELLED)

    listing = client.get("/api/v1/site-context/events/", HTTP_HOST="main-events.uog.edu.et")
    assert listing.status_code == 200
    slugs = {row["slug"] for row in listing.json()["results"]}
    assert "main-event" in slugs
    assert "college-event" in slugs
    assert "hidden-college" not in slugs
    assert "college-cancelled" not in slugs
    assert listing.json()["results"][0]["site_code"] in {"EVT-MAIN", "EVT-COL"}

    detail = client.get("/api/v1/site-context/events/college-event/", HTTP_HOST="main-events.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["id"] == str(eligible.pk)

    college_only = client.get("/api/v1/site-context/events/", HTTP_HOST="college-events.uog.edu.et")
    assert {row["slug"] for row in college_only.json()["results"]} >= {"college-event"}
    assert "main-event" not in {row["slug"] for row in college_only.json()["results"]}


def test_disabled_module_and_category_filter(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-CAT", name="Category Site", organization_unit=owner)
    _host(site, "evt-cat.uog.edu.et")
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    category = Category.objects.create(
        site=site, kind=Category.Kind.EVENTS, code="EVT_LECTURES",
        name="Lectures", slug="lectures", created_by=actor, updated_by=actor,
    )
    _published(site, title="Lecture", slug="lecture", category=category)
    _published(site, title="Other", slug="other")

    cats = client.get("/api/v1/site-context/events/categories/", HTTP_HOST="evt-cat.uog.edu.et")
    assert cats.status_code == 200
    assert any(row["slug"] == "lectures" for row in cats.json()["results"])

    filtered = client.get(
        "/api/v1/site-context/events/?category=lectures",
        HTTP_HOST="evt-cat.uog.edu.et",
    )
    assert {row["slug"] for row in filtered.json()["results"]} == {"lecture"}

    disable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)
    assert client.get("/api/v1/site-context/events/", HTTP_HOST="evt-cat.uog.edu.et").status_code == 404
    assert client.get("/api/v1/site-context/events/calendar/?year=2031&month=6", HTTP_HOST="evt-cat.uog.edu.et").status_code == 404
