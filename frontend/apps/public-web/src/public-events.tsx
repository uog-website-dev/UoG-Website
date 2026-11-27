"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { publicFetchInit, usePublicSiteBranding } from "@uog/ui";
import type { EventLifecycle, SiteEventRecord } from "@uog/types";

interface PageResult {
  count: number;
  next: string | null;
  previous: string | null;
  results: SiteEventRecord[];
}

interface CalendarDay {
  date: string;
  count: number;
  event_ids: string[];
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
}

function safeEventsPage(value: unknown): PageResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Number.isInteger(row.count) || Number(row.count) < 0 || !Array.isArray(row.results)) return null;
  const results: SiteEventRecord[] = [];
  for (const item of row.results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const event = item as Record<string, unknown>;
    if (typeof event.id !== "string" || typeof event.title !== "string" || typeof event.slug !== "string") return null;
    if ("organizer_email" in event || "private_email" in event) return null;
    results.push(event as unknown as SiteEventRecord);
  }
  return {
    count: Number(row.count),
    next: typeof row.next === "string" ? row.next : null,
    previous: typeof row.previous === "string" ? row.previous : null,
    results,
  };
}

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
  });
  if (!end) return dateLabel;
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${dateLabel} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return `${dateLabel} – ${end.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function registrationLabel(event: SiteEventRecord) {
  if (event.status === "CANCELLED") return "Cancelled";
  if (!event.registration_required) return "Open attendance";
  if (event.accepts_registration) return "Registration open";
  return "Registration closed";
}

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month - 1, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < startPad; i += 1) cells.push({ date: null, day: null });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date, day });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
}

function EventCard({ event }: { event: SiteEventRecord }) {
  return (
    <Box
      component="article"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        py: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="h3" component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>
        <Link href={`/events/${encodeURIComponent(event.slug)}`} underline="hover" color="inherit">
          {event.title}
        </Link>
      </Typography>
      <Typography variant="body2" color="text.secondary">{formatWhen(event)}</Typography>
      {event.venue ? <Typography variant="body2">{event.venue}</Typography> : null}
      {event.summary ? <Typography variant="body1">{event.summary}</Typography> : null}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Chip size="small" label={registrationLabel(event)} />
        {event.lifecycle ? <Chip size="small" variant="outlined" label={String(event.lifecycle).replace("_", " ")} /> : null}
        {event.category_name ? <Chip size="small" variant="outlined" label={event.category_name} /> : null}
        {event.site_code ? <Chip size="small" variant="outlined" label={event.site_code} /> : null}
      </Box>
    </Box>
  );
}

export function PublicEventsPage() {
  const router = useRouter();
  const site = usePublicSiteBranding();
  const search = useSearchParams();
  const tab = search.get("tab") === "past" ? "past" : "upcoming";
  const q = search.get("q")?.trim() ?? "";
  const category = search.get("category")?.trim() ?? "";
  const onDate = search.get("on_date")?.trim() ?? "";
  const page = search.get("page") ?? "1";
  const now = new Date();
  const year = Number(search.get("year") || now.getFullYear());
  const month = Number(search.get("month") || now.getMonth() + 1);
  const [draftQ, setDraftQ] = useState(q);
  const [draftCategory, setDraftCategory] = useState(category);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [calendarDays, setCalendarDays] = useState<Record<string, CalendarDay>>({});
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);
  const identity = JSON.stringify([tab, q, category, onDate, page, year, month, attempt]);
  const [view, setView] = useState<{
    key: string;
    phase: "loading" | "ready" | "disabled" | "error";
    data: PageResult | null;
    message: string;
  }>({ key: "", phase: "loading", data: null, message: "" });
  const current = view.key === identity ? view : null;
  const cells = useMemo(() => monthMatrix(year, month), [year, month]);
  const marked = useMemo(() => new Set(Object.keys(calendarDays)), [calendarDays]);

  useEffect(() => {
    setDraftQ(q);
    setDraftCategory(category);
  }, [q, category]);

  useEffect(() => {
    if (!site.modules.events || site.id == null) return;
    const controller = new AbortController();
    void fetch("/api/v1/site-context/events/categories/", { ...publicFetchInit(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json();
        const rows = Array.isArray(body.results) ? body.results : [];
        setCategories(
          rows.filter(
            (row: unknown): row is CategoryRow =>
              !!row &&
              typeof row === "object" &&
              typeof (row as CategoryRow).id === "string" &&
              typeof (row as CategoryRow).name === "string" &&
              typeof (row as CategoryRow).slug === "string",
          ),
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [site]);

  useEffect(() => {
    if (!site.modules.events || site.id == null) return;
    const controller = new AbortController();
    void fetch(
      `/api/v1/site-context/events/calendar/?year=${year}&month=${month}`,
      { ...publicFetchInit(), signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json();
        const days = Array.isArray(body.days) ? body.days : [];
        const map: Record<string, CalendarDay> = {};
        for (const day of days) {
          if (day && typeof day.date === "string") map[day.date] = day as CalendarDay;
        }
        setCalendarDays(map);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [site, year, month]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setView({ key: identity, phase: "loading", data: null, message: "" });
    async function load() {
      try {
        if (!site.modules.events || site.id == null) {
          if (!cancelled) setView({ key: identity, phase: "disabled", data: null, message: "" });
          return;
        }
        const params = new URLSearchParams();
        params.set("lifecycle", tab === "past" ? "directory_past" : "directory_upcoming");
        params.set("page", page);
        params.set("page_size", "20");
        if (q) params.set("search", q);
        if (category) params.set("category", category);
        if (onDate) params.set("on_date", onDate);
        const response = await fetch(`/api/v1/site-context/events/?${params}`, {
          ...publicFetchInit(),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 400 || response.status === 404
              ? "This Events page is unavailable. Adjust your filters or return to the first page."
              : "Events are temporarily unavailable. Please try again.",
          );
        }
        const data = safeEventsPage(await response.json());
        if (!data) throw new Error("Events could not be loaded safely. Please try again.");
        if (cancelled) return;
        setView({ key: identity, phase: "ready", data, message: "" });
        if (focusAfterLoad.current) {
          focusAfterLoad.current = false;
          requestAnimationFrame(() => heading.current?.focus());
        }
      } catch (error) {
        if (!cancelled) {
          setView({
            key: identity,
            phase: "error",
            data: null,
            message:
              error instanceof Error && error.name === "Error"
                ? error.message
                : "Events are temporarily unavailable. Please try again.",
          });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [identity, tab, q, category, onDate, page, site]);

  function navigate(next: Record<string, string | null>) {
    const params = new URLSearchParams();
    const values = {
      tab: next.tab ?? tab,
      q: next.q ?? q,
      category: next.category ?? category,
      on_date: next.on_date ?? onDate,
      page: next.page ?? page,
      year: next.year ?? String(year),
      month: next.month ?? String(month),
    };
    if (values.tab === "past") params.set("tab", "past");
    if (values.q) params.set("q", values.q);
    if (values.category) params.set("category", values.category);
    if (values.on_date) params.set("on_date", values.on_date);
    if (values.page && values.page !== "1") params.set("page", values.page);
    if (Number(values.year) !== now.getFullYear()) params.set("year", values.year);
    if (Number(values.month) !== now.getMonth() + 1) params.set("month", values.month);
    focusAfterLoad.current = true;
    router.push(params.size ? `/events?${params}` : "/events", { scroll: false });
  }

  function shiftMonth(delta: number) {
    const date = new Date(year, month - 1 + delta, 1);
    navigate({
      year: String(date.getFullYear()),
      month: String(date.getMonth() + 1),
      page: "1",
    });
  }

  const loading = !current || current.phase === "loading";
  const data = current?.data;
  const monthLabel = new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }} aria-busy={loading}>
      <Typography
        ref={heading}
        tabIndex={-1}
        variant="h1"
        component="h1"
        sx={{ fontSize: { xs: "2rem", sm: "2.75rem" }, fontWeight: 700 }}
      >
        Events &amp; Calendar
      </Typography>
      <Typography color="text.secondary">
        Discover upcoming and past activities by date, category, and Site.
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, value: "upcoming" | "past") => navigate({ tab: value, page: "1" })}
        aria-label="Event directory tabs"
      >
        <Tab value="upcoming" label="Upcoming" />
        <Tab value="past" label="Past" />
      </Tabs>

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(280px, 340px) minmax(0, 1fr)" },
          alignItems: "start",
        }}
      >
        <Box
          component="section"
          aria-labelledby="events-calendar-heading"
          sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
        >
          <Typography id="events-calendar-heading" variant="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>
            Calendar
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Button onClick={() => shiftMonth(-1)} aria-label={`Previous month from ${monthLabel}`}>
              Previous
            </Button>
            <Typography component="h3" sx={{ fontWeight: 600 }}>{monthLabel}</Typography>
            <Button onClick={() => shiftMonth(1)} aria-label={`Next month from ${monthLabel}`}>
              Next
            </Button>
          </Box>
          <Box
            role="grid"
            aria-label={`${monthLabel} event calendar`}
            sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5 }}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <Typography key={label} role="columnheader" variant="caption" sx={{ textAlign: "center", fontWeight: 600 }}>
                {label}
              </Typography>
            ))}
            {cells.map((cell, index) => {
              if (!cell.date || cell.day == null) {
                return <Box key={`pad-${index}`} role="gridcell" aria-hidden sx={{ minHeight: 40 }} />;
              }
              const hasEvents = marked.has(cell.date);
              const selected = onDate === cell.date;
              const count = calendarDays[cell.date]?.count ?? 0;
              const label = hasEvents
                ? `${cell.day} ${monthLabel}, ${count} event${count === 1 ? "" : "s"}`
                : `${cell.day} ${monthLabel}, no events`;
              return (
                <Button
                  key={cell.date}
                  role="gridcell"
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => navigate({ on_date: selected ? "" : cell.date, page: "1" })}
                  sx={{
                    minWidth: 0,
                    minHeight: 40,
                    borderRadius: 1,
                    fontWeight: hasEvents ? 700 : 400,
                    bgcolor: selected ? "action.selected" : hasEvents ? "action.hover" : "transparent",
                    border: hasEvents ? "1px solid" : "1px solid transparent",
                    borderColor: hasEvents ? "primary.main" : "transparent",
                  }}
                >
                  {cell.day}
                </Button>
              );
            })}
          </Box>
          {onDate ? (
            <Button onClick={() => navigate({ on_date: "", page: "1" })}>
              Clear date {onDate}
            </Button>
          ) : null}
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box
            component="form"
            aria-label="Event filters"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: draftQ.trim(), category: draftCategory, page: "1" });
            }}
            sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 2, alignItems: { sm: "center" } }}
          >
            <TextField
              label="Search"
              value={draftQ}
              onChange={(event) => setDraftQ(event.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              select
              label="Category"
              value={draftCategory}
              onChange={(event) => setDraftCategory(event.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All categories</MenuItem>
              {categories.map((row) => (
                <MenuItem key={row.id} value={row.slug}>{row.name}</MenuItem>
              ))}
            </TextField>
            <Button type="submit" variant="contained">Apply</Button>
            {q || category || onDate ? (
              <Button onClick={() => navigate({ q: "", category: "", on_date: "", page: "1" })}>Clear</Button>
            ) : null}
          </Box>

          {loading ? (
            <>
              <Typography role="status">Loading events…</Typography>
              <Box aria-hidden sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {[0, 1, 2].map((index) => <Skeleton key={index} variant="rounded" height={96} />)}
              </Box>
            </>
          ) : null}
          {current?.phase === "disabled" ? (
            <Typography role="status">Events are not available for this Site.</Typography>
          ) : null}
          {current?.phase === "error" ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" onClick={() => { focusAfterLoad.current = true; setAttempt((value) => value + 1); }}>
                  Try again
                </Button>
              }
            >
              {current.message}
            </Alert>
          ) : null}
          {current?.phase === "ready" && data ? (
            <>
              {data.count === 0 ? (
                <Typography role="status">
                  No {tab} events match these filters. Try another date or clear filters.
                </Typography>
              ) : (
                <Box component="section" aria-label={`${tab} events`}>
                  {data.results.map((event) => <EventCard key={event.id} event={event} />)}
                </Box>
              )}
              {data.count > 0 ? (
                <Box component="nav" aria-label="Events pagination" sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                  <Button disabled={!data.previous} onClick={() => navigate({ page: String(Number(page) - 1) })}>
                    Previous page
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    Page {page} · {data.count} events
                  </Typography>
                  <Button disabled={!data.next} onClick={() => navigate({ page: String(Number(page) + 1) })}>
                    Next page
                  </Button>
                </Box>
              ) : null}
            </>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

export function PublicEventDetailPage({ slug }: { slug: string }) {
  const site = usePublicSiteBranding();
  const [event, setEvent] = useState<SiteEventRecord | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "disabled" | "error" | "missing">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
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
        if (!body || typeof body !== "object" || typeof body.title !== "string") {
          throw new Error("Event details could not be loaded safely.");
        }
        if ("organizer_email" in body) throw new Error("Event details could not be loaded safely.");
        if (!cancelled) {
          setEvent(body as SiteEventRecord);
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
  }, [site, slug]);

  if (phase === "disabled") return <Typography role="status">Events are not available for this Site.</Typography>;
  if (phase === "missing") return <Typography role="status">This Event was not found.</Typography>;
  if (phase === "error") return <Alert severity="error">{message}</Alert>;
  if (phase === "loading" || !event) return <Typography role="status">Loading Event…</Typography>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 820 }}>
      <Button href="/events" sx={{ alignSelf: "flex-start" }}>All Events</Button>
      <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "2rem", sm: "2.75rem" }, fontWeight: 700 }}>
        {event.title}
      </Typography>
      <Typography color="text.secondary">{formatWhen(event)}</Typography>
      {event.venue ? <Typography>{event.venue}</Typography> : null}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Chip label={registrationLabel(event)} />
        <Chip variant="outlined" label={(event.lifecycle as EventLifecycle).replace("_", " ")} />
      </Box>
      {event.status === "CANCELLED" && event.cancellation_notice ? (
        <Alert severity="warning">{event.cancellation_notice}</Alert>
      ) : null}
      {event.summary ? <Typography variant="h2" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>{event.summary}</Typography> : null}
      {event.description ? (
        <Box
          component="div"
          sx={{ "& p": { mb: 1.5 } }}
          dangerouslySetInnerHTML={{ __html: event.description }}
        />
      ) : null}
    </Box>
  );
}
