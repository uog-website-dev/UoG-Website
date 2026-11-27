"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { publicFetchInit, usePublicSiteBranding } from "@uog/ui";
import type { EventLifecycle, PublicEventSections, SiteEventRecord } from "@uog/types";

type DetailTab = "overview" | "schedule" | "speakers";

interface AgendaSessionPerson {
  role?: string;
  person_summary?: {
    display_name?: string;
    affiliation?: string;
  } | null;
}

interface AgendaSession {
  id: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  venue_room?: string;
  track?: string;
  status?: string;
  public_notes?: string;
  speaker_labels?: string[];
  people?: AgendaSessionPerson[];
}

interface AgendaTrack {
  track: string;
  sessions: AgendaSession[];
}

interface AgendaDay {
  date: string;
  tracks: AgendaTrack[];
}

interface PublicSpeaker {
  id: string;
  display_name: string;
  affiliation?: string;
  biography?: string;
  profile_photo_url?: string | null;
  public_links?: Array<{ label: string; url: string }>;
  roles?: Array<{ role: string; session_id: string; session_title: string; day_date: string | null }>;
}

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "Overview",
  schedule: "Schedule & Sessions",
  speakers: "Speakers",
};

function formatWhen(event: SiteEventRecord) {
  if (!event.starts_at) return "Schedule to be announced";
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  const dateLabel = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.timezone || undefined,
  });
  if (!end) return `${dateLabel} (${event.timezone})`;
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${dateLabel} – ${end.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: event.timezone || undefined,
    })} (${event.timezone})`;
  }
  return `${dateLabel} – ${end.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.timezone || undefined,
  })} (${event.timezone})`;
}

function formatSessionTime(session: AgendaSession, timeZone?: string) {
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at);
  const startLabel = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || undefined,
  });
  const endLabel = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || undefined,
  });
  return `${startLabel} – ${endLabel}`;
}

function formatDayHeading(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function registrationLabel(event: SiteEventRecord) {
  if (event.status === "CANCELLED") return "Cancelled";
  if (!event.registration_required) return "Open attendance";
  if (event.accepts_registration) return "Registration open";
  return "Registration closed";
}

function isSafePublicEvent(value: unknown): value is SiteEventRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.slug !== "string") return false;
  if ("organizer_email" in row || "organizer_phone" in row || "private_email" in row) return false;
  return true;
}

function visibleTabs(sections: PublicEventSections | undefined): DetailTab[] {
  const tabs: DetailTab[] = ["overview"];
  if (sections?.schedule) tabs.push("schedule");
  if (sections?.speakers) tabs.push("speakers");
  return tabs;
}

function personNames(session: AgendaSession) {
  const assigned = (session.people ?? [])
    .map((row) => {
      const name = row.person_summary?.display_name?.trim();
      if (!name) return null;
      const role = row.role ? ` (${row.role.toLowerCase()})` : "";
      return `${name}${role}`;
    })
    .filter(Boolean) as string[];
  const labels = (session.speaker_labels ?? []).map((label) => label.trim()).filter(Boolean);
  return [...assigned, ...labels];
}

export function PublicEventDetailPage({
  slug,
  initialEvent = null,
}: {
  slug: string;
  initialEvent?: SiteEventRecord | null;
}) {
  const site = usePublicSiteBranding();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = (searchParams.get("tab") || "overview") as DetailTab;
  const sessionFocus = searchParams.get("session") || "";
  const [event, setEvent] = useState<SiteEventRecord | null>(initialEvent);
  const [phase, setPhase] = useState<"loading" | "ready" | "disabled" | "error" | "missing">(
    initialEvent ? "ready" : "loading",
  );
  const [message, setMessage] = useState("");
  const [agenda, setAgenda] = useState<AgendaDay[] | null>(null);
  const [speakers, setSpeakers] = useState<PublicSpeaker[] | null>(null);
  const [sectionError, setSectionError] = useState("");
  const focusRef = useRef<HTMLElement | null>(null);

  const tabs = useMemo(() => visibleTabs(event?.sections), [event?.sections]);
  const activeTab: DetailTab = tabs.includes(requestedTab) ? requestedTab : "overview";

  useEffect(() => {
    if (initialEvent) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      if (!site.modules.events || site.id == null) {
        if (!cancelled) setPhase("disabled");
        return;
      }
      try {
        const response = await fetch(`/api/v1/site-context/events/${encodeURIComponent(slug)}/`, {
          ...publicFetchInit(),
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (!cancelled) setPhase("missing");
          return;
        }
        if (!response.ok) throw new Error("Event details are temporarily unavailable.");
        const body = await response.json();
        if (!isSafePublicEvent(body)) throw new Error("Event details could not be loaded safely.");
        if (!cancelled) {
          setEvent(body);
          setPhase("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setPhase("error");
          setMessage(error instanceof Error ? error.message : "Event details are temporarily unavailable.");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [site, slug, initialEvent]);

  useEffect(() => {
    if (!event || activeTab !== "schedule") return;
    if (agenda) return;
    const controller = new AbortController();
    let cancelled = false;
    async function loadAgenda() {
      try {
        const response = await fetch(`/api/v1/site-context/events/${encodeURIComponent(slug)}/agenda/`, {
          ...publicFetchInit(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Schedule is temporarily unavailable.");
        const body = await response.json();
        if (!body || !Array.isArray(body.days)) throw new Error("Schedule could not be loaded safely.");
        if (!cancelled) {
          setAgenda(body.days as AgendaDay[]);
          setSectionError("");
        }
      } catch (error) {
        if (!cancelled) {
          setSectionError(error instanceof Error ? error.message : "Schedule is temporarily unavailable.");
        }
      }
    }
    void loadAgenda();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [event, activeTab, agenda, slug]);

  useEffect(() => {
    if (!event || activeTab !== "speakers") return;
    if (speakers) return;
    const controller = new AbortController();
    let cancelled = false;
    async function loadSpeakers() {
      try {
        const response = await fetch(`/api/v1/site-context/events/${encodeURIComponent(slug)}/speakers/`, {
          ...publicFetchInit(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Speakers are temporarily unavailable.");
        const body = await response.json();
        if (!body || !Array.isArray(body.results)) throw new Error("Speakers could not be loaded safely.");
        if (JSON.stringify(body).includes("private_email") || JSON.stringify(body).includes("organizer_email")) {
          throw new Error("Speakers could not be loaded safely.");
        }
        if (!cancelled) {
          setSpeakers(body.results as PublicSpeaker[]);
          setSectionError("");
        }
      } catch (error) {
        if (!cancelled) {
          setSectionError(error instanceof Error ? error.message : "Speakers are temporarily unavailable.");
        }
      }
    }
    void loadSpeakers();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [event, activeTab, speakers, slug]);

  useEffect(() => {
    if (activeTab !== "schedule" || !sessionFocus || !agenda) return;
    const node = document.getElementById(`session-${sessionFocus}`);
    if (node) {
      focusRef.current = node;
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      if (typeof node.focus === "function") node.focus();
    }
  }, [activeTab, sessionFocus, agenda]);

  function selectTab(next: DetailTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (next !== "schedule") params.delete("session");
    router.replace(`/events/${encodeURIComponent(slug)}?${params.toString()}`, { scroll: false });
  }

  if (phase === "disabled") return <Typography role="status">Events are not available for this Site.</Typography>;
  if (phase === "missing") return <Typography role="status">This Event was not found.</Typography>;
  if (phase === "error") return <Alert severity="error">{message}</Alert>;
  if (phase === "loading" || !event) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography role="status">Loading Event…</Typography>
        <Skeleton variant="rounded" height={220} />
        <Skeleton variant="text" height={48} />
        <Skeleton variant="rounded" height={120} />
      </Box>
    );
  }

  const cancelled = event.status === "CANCELLED";
  const registrationEnabled = !cancelled && event.accepts_registration;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, maxWidth: 960 }}>
      <Box
        component="nav"
        aria-label="Breadcrumb"
        sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", color: "text.secondary", fontSize: "0.875rem" }}
      >
        <Link href="/" underline="hover" color="inherit" sx={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
          Home
        </Link>
        <Box component="span" aria-hidden>›</Box>
        <Link href="/events" underline="hover" color="inherit" sx={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
          Events
        </Link>
        <Box component="span" aria-hidden>›</Box>
        <Typography component="span" aria-current="page" color="text.primary" sx={{ fontWeight: 600 }}>
          {event.title}
        </Typography>
      </Box>

      {event.banner_url ? (
        <Box
          component="img"
          src={event.banner_url}
          alt=""
          sx={{ width: "100%", maxHeight: { xs: 220, md: 360 }, objectFit: "cover", borderRadius: 2 }}
        />
      ) : null}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        {event.category_name ? <Chip label={event.category_name} sx={{ alignSelf: "flex-start" }} /> : null}
        <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "2rem", sm: "2.75rem" }, fontWeight: 700 }}>
          {event.title}
        </Typography>
        <Typography color="text.secondary">{formatWhen(event)}</Typography>
        {event.venue ? <Typography><strong>Venue:</strong> {event.venue}</Typography> : null}
        {event.format ? (
          <Typography color="text.secondary" sx={{ textTransform: "capitalize" }}>
            Format: {event.format.toLowerCase()}
            {event.online_url ? (
              <>
                {" · "}
                <Link href={event.online_url} target="_blank" rel="noopener noreferrer">
                  Join online
                </Link>
              </>
            ) : null}
          </Typography>
        ) : null}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={registrationLabel(event)} color={cancelled ? "warning" : "default"} />
          <Chip variant="outlined" label={(event.lifecycle as EventLifecycle).replace("_", " ")} />
          {event.timezone ? <Chip variant="outlined" label={event.timezone} /> : null}
        </Box>
      </Box>

      {cancelled ? (
        <Alert severity="warning">
          This Event has been cancelled.
          {event.cancellation_notice ? ` ${event.cancellation_notice}` : ""}
        </Alert>
      ) : null}

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button
          variant="contained"
          disabled={!registrationEnabled}
          aria-disabled={!registrationEnabled}
          href={registrationEnabled && event.online_url ? event.online_url : undefined}
          component={registrationEnabled && event.online_url ? "a" : "button"}
          target={registrationEnabled && event.online_url ? "_blank" : undefined}
          rel={registrationEnabled && event.online_url ? "noopener noreferrer" : undefined}
        >
          {cancelled ? "Registration unavailable" : registrationEnabled ? "Register for this Event" : "Registration closed"}
        </Button>
        {(event.contact_name || event.organizer_name) ? (
          <Typography sx={{ alignSelf: "center" }} color="text.secondary">
            Contact: {event.contact_name || event.organizer_name}
          </Typography>
        ) : null}
      </Box>

      <Tabs
        value={activeTab}
        onChange={(_event, value: DetailTab) => selectTab(value)}
        aria-label="Event sections"
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {tabs.map((tab) => (
          <Tab key={tab} value={tab} label={TAB_LABELS[tab]} id={`event-tab-${tab}`} aria-controls={`event-panel-${tab}`} />
        ))}
      </Tabs>

      <Box
        role="tabpanel"
        id={`event-panel-${activeTab}`}
        aria-labelledby={`event-tab-${activeTab}`}
        sx={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        {activeTab === "overview" ? (
          <>
            {event.summary ? (
              <Typography variant="h2" sx={{ fontSize: "1.15rem", fontWeight: 600 }}>
                {event.summary}
              </Typography>
            ) : null}
            {event.description ? (
              <Box
                component="div"
                sx={{ "& p": { mb: 1.5 }, overflowWrap: "anywhere" }}
                dangerouslySetInnerHTML={{ __html: event.description }}
              />
            ) : (
              <Typography color="text.secondary">No overview details were published for this Event.</Typography>
            )}
          </>
        ) : null}

        {activeTab === "schedule" ? (
          sectionError ? (
            <Alert severity="error">{sectionError}</Alert>
          ) : !agenda ? (
            <Typography role="status">Loading schedule…</Typography>
          ) : agenda.length === 0 ? (
            <Typography role="status">No public sessions are available yet.</Typography>
          ) : (
            agenda.map((day) => (
              <Box key={day.date} component="section" aria-label={formatDayHeading(day.date)} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  {formatDayHeading(day.date)}
                </Typography>
                {day.tracks.map((track) => (
                  <Box key={`${day.date}-${track.track}`} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {day.tracks.length > 1 || track.track !== "General" ? (
                      <Typography component="h3" sx={{ fontWeight: 600 }}>{track.track}</Typography>
                    ) : null}
                    {track.sessions.map((session) => {
                      const names = personNames(session);
                      return (
                        <Box
                          key={session.id}
                          id={`session-${session.id}`}
                          component="article"
                          tabIndex={-1}
                          sx={{
                            py: 1.5,
                            borderBottom: "1px solid",
                            borderColor: "divider",
                            outline: sessionFocus === session.id ? "2px solid" : "none",
                            outlineColor: "primary.main",
                            outlineOffset: 2,
                          }}
                        >
                          <Typography component="h4" sx={{ fontWeight: 700 }}>{session.title}</Typography>
                          <Typography color="text.secondary">
                            {formatSessionTime(session, event.timezone)}
                            {session.venue_room ? ` · ${session.venue_room}` : ""}
                            {session.status && session.status !== "SCHEDULED" ? ` · ${session.status.toLowerCase()}` : ""}
                          </Typography>
                          {names.length ? (
                            <Typography variant="body2">Speakers / moderators: {names.join(", ")}</Typography>
                          ) : null}
                          {session.description ? (
                            <Box
                              component="div"
                              sx={{ mt: 1, "& p": { mb: 1 }, overflowWrap: "anywhere" }}
                              dangerouslySetInnerHTML={{ __html: session.description }}
                            />
                          ) : null}
                          {session.public_notes ? (
                            <Typography variant="body2" color="text.secondary">{session.public_notes}</Typography>
                          ) : null}
                          <Button
                            size="small"
                            href={`/events/${encodeURIComponent(slug)}?tab=schedule&session=${encodeURIComponent(session.id)}`}
                            sx={{ alignSelf: "flex-start", mt: 0.5 }}
                          >
                            Session link
                          </Button>
                        </Box>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            ))
          )
        ) : null}

        {activeTab === "speakers" ? (
          sectionError ? (
            <Alert severity="error">{sectionError}</Alert>
          ) : !speakers ? (
            <Typography role="status">Loading speakers…</Typography>
          ) : speakers.length === 0 ? (
            <Typography role="status">No public speakers are listed for this Event.</Typography>
          ) : (
            <Box
              component="ul"
              sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}
            >
              {speakers.map((person) => (
                <Box
                  component="li"
                  key={person.id}
                  sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", borderBottom: "1px solid", borderColor: "divider", pb: 1.5 }}
                >
                  {person.profile_photo_url ? (
                    <Box
                      component="img"
                      src={person.profile_photo_url}
                      alt=""
                      sx={{ width: 72, height: 72, borderRadius: 2, objectFit: "cover", flexShrink: 0 }}
                    />
                  ) : null}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>{person.display_name}</Typography>
                    {person.affiliation ? <Typography color="text.secondary">{person.affiliation}</Typography> : null}
                    {person.roles && person.roles.length > 0 ? (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {person.roles.map((role) => `${role.role}: ${role.session_title}`).join(" · ")}
                      </Typography>
                    ) : null}
                    {person.biography ? (
                      <Box
                        component="div"
                        sx={{ mt: 1, "& p": { mb: 1 }, overflowWrap: "anywhere" }}
                        dangerouslySetInnerHTML={{ __html: person.biography }}
                      />
                    ) : null}
                    {person.public_links && person.public_links.length > 0 ? (
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                        {person.public_links.map((link) => (
                          <Link key={`${person.id}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">
                            {link.label}
                          </Link>
                        ))}
                      </Box>
                    ) : null}
                  </Box>
                </Box>
              ))}
            </Box>
          )
        ) : null}
      </Box>
    </Box>
  );
}
