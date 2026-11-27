"""Realistic pilot Event blueprints for release validation (P0-EVENT-015).

Builds a simple seminar and a multi-day academic symposium with parallel
sessions and speakers. Callers remain responsible for Site Admin authorization,
module enablement, Document/Media association, and publication.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.cms.event_models import Event, EventFormat, EventStatus
from apps.cms.event_person_models import EventPerson, SessionPerson, SessionPersonRole
from apps.cms.event_session_models import EventSession, SessionStatus, SessionType, SessionVisibility


SEMINAR_SLUG = "pilot-research-seminar"
SYMPOSIUM_SLUG = "pilot-academic-symposium"


def _local_day(moment, tz_name: str):
    return timezone.localtime(moment, ZoneInfo(tz_name)).date()


def build_seminar(site, *, actor=None, starts_at=None) -> dict[str, Any]:
    """Single-day seminar: one keynote session and one speaker."""
    tz_name = "Africa/Addis_Ababa"
    start = starts_at or (timezone.now().replace(microsecond=0) + timedelta(days=7))
    end = start + timedelta(hours=3)
    event = Event.objects.create(
        site=site,
        title="Pilot Research Seminar",
        slug=SEMINAR_SLUG,
        summary="A half-day research methods seminar for graduate students.",
        description="<p>Hands-on methods clinic with Q&amp;A.</p>",
        status=EventStatus.DRAFT,
        starts_at=start,
        ends_at=end,
        timezone=tz_name,
        format=EventFormat.PHYSICAL,
        venue="Senate Hall",
        organizer_name="Graduate School",
        registration_required=True,
        registration_open=True,
        registration_capacity=40,
        waitlist_enabled=True,
        registration_required_fields=["participant_name", "email"],
        registration_notice="Bring a student ID.",
        created_by=actor,
        updated_by=actor,
    )
    session = EventSession.objects.create(
        event=event,
        day_date=_local_day(start, tz_name),
        starts_at=start + timedelta(minutes=30),
        ends_at=start + timedelta(hours=2),
        title="Research Methods Keynote",
        description="<p>Designing reproducible campus studies.</p>",
        session_type=SessionType.KEYNOTE,
        venue_room="Senate Hall",
        track="Main",
        sort_order=0,
        visibility=SessionVisibility.PUBLIC,
        status=SessionStatus.SCHEDULED,
        created_by=actor,
        updated_by=actor,
    )
    speaker = EventPerson.objects.create(
        event=event,
        display_name="Dr. Hanna Bekele",
        affiliation="University of Gondar",
        biography="<p>Methods and research integrity.</p>",
        visibility="PUBLIC",
        sort_order=0,
        created_by=actor,
        updated_by=actor,
    )
    SessionPerson.objects.create(
        session=session,
        person=speaker,
        role=SessionPersonRole.SPEAKER,
        sort_order=0,
        created_by=actor,
        updated_by=actor,
    )
    return {"event": event, "sessions": [session], "people": [speaker], "kind": "seminar"}


def build_symposium(site, *, actor=None, starts_at=None) -> dict[str, Any]:
    """Multi-day symposium with parallel tracks and multiple speakers."""
    tz_name = "Africa/Addis_Ababa"
    day1 = starts_at or (timezone.now().replace(microsecond=0) + timedelta(days=14))
    day2 = day1 + timedelta(days=1)
    event = Event.objects.create(
        site=site,
        title="Pilot Academic Symposium",
        slug=SYMPOSIUM_SLUG,
        summary="Two-day academic symposium with parallel tracks.",
        description="<p>Campus research showcase across Health and Computing tracks.</p>",
        status=EventStatus.DRAFT,
        starts_at=day1,
        ends_at=day2 + timedelta(hours=8),
        timezone=tz_name,
        format=EventFormat.HYBRID,
        venue="Innovation Complex",
        online_url="https://meet.example.edu/pilot-symposium",
        organizer_name="Research Directorate",
        registration_required=True,
        registration_open=True,
        registration_capacity=120,
        waitlist_enabled=True,
        registration_required_fields=["participant_name", "email", "organization"],
        registration_notice="Registered attendees receive session packs.",
        created_by=actor,
        updated_by=actor,
    )

    sessions: list[EventSession] = []
    # Day 1 parallel tracks
    for index, (title, track, room, offset) in enumerate((
        ("Opening Plenary", "Plenary", "Auditorium", 0),
        ("Health Informatics Panel", "Health", "Room 101", 90),
        ("Computing Systems Workshop", "Computing", "Room 202", 90),
    )):
        start = day1 + timedelta(minutes=offset)
        sessions.append(EventSession.objects.create(
            event=event,
            day_date=_local_day(day1, tz_name),
            starts_at=start,
            ends_at=start + timedelta(minutes=75),
            title=title,
            description=f"<p>{title} for the pilot symposium.</p>",
            session_type=SessionType.PANEL if "Panel" in title else (
                SessionType.WORKSHOP if "Workshop" in title else SessionType.KEYNOTE
            ),
            venue_room=room,
            track=track,
            sort_order=index,
            visibility=SessionVisibility.PUBLIC,
            status=SessionStatus.SCHEDULED,
            created_by=actor,
            updated_by=actor,
        ))
    # Day 2
    for index, (title, track, room) in enumerate((
        ("Poster Session", "Plenary", "Gallery"),
        ("Closing Roundtable", "Plenary", "Auditorium"),
    ), start=3):
        start = day2 + timedelta(hours=2 if index == 3 else 4)
        sessions.append(EventSession.objects.create(
            event=event,
            day_date=_local_day(day2, tz_name),
            starts_at=start,
            ends_at=start + timedelta(hours=1, minutes=30),
            title=title,
            description=f"<p>{title}.</p>",
            session_type=SessionType.OTHER if "Poster" in title else SessionType.PANEL,
            venue_room=room,
            track=track,
            sort_order=index,
            visibility=SessionVisibility.PUBLIC,
            status=SessionStatus.SCHEDULED,
            created_by=actor,
            updated_by=actor,
        ))

    people = [
        EventPerson.objects.create(
            event=event,
            display_name=name,
            affiliation=affiliation,
            biography=f"<p>{name} biography.</p>",
            visibility="PUBLIC",
            sort_order=order,
            created_by=actor,
            updated_by=actor,
        )
        for order, (name, affiliation) in enumerate((
            ("Prof. Selamawit Desta", "College of Medicine"),
            ("Dr. Yonas Alemu", "Faculty of Informatics"),
            ("Ms. Rahel Tadesse", "Research Directorate"),
        ))
    ]
    SessionPerson.objects.create(
        session=sessions[0], person=people[2], role=SessionPersonRole.MODERATOR, sort_order=0,
        created_by=actor, updated_by=actor,
    )
    SessionPerson.objects.create(
        session=sessions[1], person=people[0], role=SessionPersonRole.SPEAKER, sort_order=0,
        created_by=actor, updated_by=actor,
    )
    SessionPerson.objects.create(
        session=sessions[2], person=people[1], role=SessionPersonRole.SPEAKER, sort_order=0,
        created_by=actor, updated_by=actor,
    )
    return {"event": event, "sessions": sessions, "people": people, "kind": "symposium"}


def seed_site_pilots(site, *, actor=None) -> dict[str, Any]:
    """Create both pilot blueprints on a Site (draft until published by caller)."""
    return {
        "seminar": build_seminar(site, actor=actor),
        "symposium": build_symposium(site, actor=actor),
    }
