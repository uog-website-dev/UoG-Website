"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { publicFetchInit, usePublicSiteBranding } from "@uog/ui";

interface PublicCategory { id: string; name: string; slug: string }
interface PublicDocument {
  id: string; title: string; slug: string; description: string; version: string;
  effective_date: string | null; published_at: string; require_login_to_download: boolean;
  file_type: string; file_url: string; categories: PublicCategory[];
}
interface PageResult { count: number; next: string | null; previous: string | null; results: PublicDocument[] }
const FILE_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/zip": "ZIP",
};

function safePage(value: unknown): PageResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Number.isInteger(row.count) || Number(row.count) < 0 || !Array.isArray(row.results)) return null;
  const results: PublicDocument[] = [];
  for (const item of row.results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const doc = item as Record<string, unknown>;
    if (typeof doc.id !== "string" || typeof doc.title !== "string" || typeof doc.file_url !== "string" || !doc.file_url.startsWith("/api/v1/site-context/documents/") || typeof doc.file_type !== "string" || !FILE_TYPES[doc.file_type]) return null;
    results.push({
      id: doc.id, title: doc.title, slug: typeof doc.slug === "string" ? doc.slug : "",
      description: typeof doc.description === "string" ? doc.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "",
      version: typeof doc.version === "string" ? doc.version : "",
      effective_date: typeof doc.effective_date === "string" ? doc.effective_date : null,
      published_at: typeof doc.published_at === "string" ? doc.published_at : "",
      require_login_to_download: doc.require_login_to_download === true,
      file_type: doc.file_type,
      file_url: `/api/documents/${encodeURIComponent(doc.id)}/file/`,
      categories: Array.isArray(doc.categories) ? doc.categories.filter((category): category is PublicCategory => !!category && typeof category === "object" && typeof (category as PublicCategory).id === "string" && typeof (category as PublicCategory).name === "string" && typeof (category as PublicCategory).slug === "string") : [],
    });
  }
  return { count: Number(row.count), next: typeof row.next === "string" ? row.next : null, previous: typeof row.previous === "string" ? row.previous : null, results };
}

export function PublicDocumentsPage() {
  const site = usePublicSiteBranding();
  const router = useRouter();
  const search = useSearchParams();
  const category = search.get("category") ?? "";
  const query = search.get("search") ?? "";
  const fileType = search.get("file_type") ?? "";
  const page = Math.max(1, Number(search.get("page") ?? "1") || 1);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftFileType, setDraftFileType] = useState(fileType);
  const [state, setState] = useState<{ key: string; loading: boolean; data: PageResult | null; error: string }>({ key: "", loading: true, data: null, error: "" });
  const heading = useRef<HTMLHeadingElement>(null);
  const identity = `${site.id}:${search.toString()}`;

  useEffect(() => {
    setDraftCategory(category); setDraftQuery(query); setDraftFileType(fileType);
    if (!site.modules.documents || site.id == null) {
      setCategories([]);
      setState({ key: identity, loading: false, data: null, error: "" });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState({ key: identity, loading: true, data: null, error: "" });
    const params = new URLSearchParams(search.toString());
    params.set("page", String(page));
    if (!params.has("page_size")) params.set("page_size", "20");
    Promise.all([
      fetch(`/api/v1/site-context/documents/?${params}`, { ...publicFetchInit(), signal: controller.signal }),
      fetch("/api/v1/site-context/documents/categories/", { ...publicFetchInit(), signal: controller.signal }),
    ]).then(async ([documentsResponse, categoriesResponse]) => {
      if (!documentsResponse.ok || !categoriesResponse.ok) throw new Error("Documents are temporarily unavailable. Please try again.");
      const [documentsBody, categoriesBody] = await Promise.all([documentsResponse.json(), categoriesResponse.json()]);
      const data = safePage(documentsBody);
      if (!data) throw new Error("Documents could not be loaded safely.");
      const categoryRows = Array.isArray(categoriesBody) ? categoriesBody.filter((row): row is PublicCategory => !!row && typeof row === "object" && typeof row.id === "string" && typeof row.name === "string" && typeof row.slug === "string") : [];
      if (!cancelled) {
        setCategories(categoryRows);
        setState({ key: identity, loading: false, data, error: "" });
      }
    }).catch(error => {
      if (!cancelled && error?.name !== "AbortError") setState({ key: identity, loading: false, data: null, error: error instanceof Error ? error.message : "Documents are temporarily unavailable." });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [identity, site, category, query, fileType, page, search]);

  function navigate(nextPage = 1, clear = false) {
    const params = new URLSearchParams();
    const selectedCategory = clear ? "" : draftCategory.trim();
    const selectedQuery = clear ? "" : draftQuery.trim();
    const selectedFileType = clear ? "" : draftFileType;
    if (selectedCategory) params.set("category", selectedCategory);
    if (selectedQuery) params.set("search", selectedQuery);
    if (selectedFileType) params.set("file_type", selectedFileType);
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(params.size ? `/documents?${params}` : "/documents", { scroll: false });
    requestAnimationFrame(() => heading.current?.focus());
  }

  const current = state.key === identity ? state : null;
  const result = current?.data;
  return <Box sx={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }} aria-busy={!current || current.loading}>
    <Typography ref={heading} tabIndex={-1} component="h1" variant="h1" sx={{ fontSize: { xs: "2rem", sm: "2.75rem" }, fontWeight: 700 }}>Documents &amp; Files</Typography>
    {!site.modules.documents || site.id == null ? <Typography role="status">Documents are not available for this Site.</Typography> : <>
      <Box component="form" aria-label="Document filters" onSubmit={event => { event.preventDefault(); navigate(1); }} sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 2, alignItems: { sm: "center" } }}>
        <TextField label="Search documents" value={draftQuery} onChange={event => setDraftQuery(event.target.value)} size="small" />
        <TextField select label="Category" value={draftCategory} onChange={event => setDraftCategory(event.target.value)} size="small" sx={{ minWidth: 220 }}>
          <MenuItem value="">All categories</MenuItem>{categories.map(row => <MenuItem value={row.slug} key={row.id}>{row.name}</MenuItem>)}
        </TextField>
        <TextField select label="File type" value={draftFileType} onChange={event => setDraftFileType(event.target.value)} size="small" sx={{ minWidth: 160 }}>
          <MenuItem value="">All file types</MenuItem>{Object.entries(FILE_TYPES).map(([mime, label]) => <MenuItem value={label.toLowerCase()} key={mime}>{label}</MenuItem>)}
        </TextField>
        <Button type="submit" variant="contained">Apply</Button>
        {category || query || fileType ? <Button onClick={() => navigate(1, true)}>Clear filters</Button> : null}
      </Box>
      {categories.length ? <Box component="nav" aria-label="Document categories" sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ mr: 0.5 }}>Browse categories</Typography>
        <Chip component="button" clickable label="All documents" color={!category ? "primary" : "default"} variant={!category ? "filled" : "outlined"} aria-pressed={!category} onClick={() => { setDraftCategory(""); const params = new URLSearchParams(search.toString()); params.delete("category"); params.delete("page"); router.push(params.size ? `/documents?${params}` : "/documents", { scroll: false }); requestAnimationFrame(() => heading.current?.focus()); }} />
        {categories.map(row => <Chip key={row.id} component="button" clickable label={row.name} color={category === row.slug ? "primary" : "default"} variant={category === row.slug ? "filled" : "outlined"} aria-pressed={category === row.slug} onClick={() => { setDraftCategory(row.slug); setDraftQuery(query); setDraftFileType(fileType); const params = new URLSearchParams(search.toString()); params.set("category", row.slug); params.delete("page"); router.push(`/documents?${params}`, { scroll: false }); requestAnimationFrame(() => heading.current?.focus()); }} />)}
      </Box> : null}
      {!current || current.loading ? <><Typography role="status">Loading documents…</Typography>{[0, 1, 2].map(index => <Skeleton key={index} variant="rounded" height={130} />)}</> : null}
      {current?.error ? <Alert severity="error">{current.error}<Button onClick={() => navigate(page)}>Try again</Button></Alert> : null}
      {result && result.count === 0 ? <Typography role="status">{category || query || fileType ? "No published documents match these filters." : "No published documents are available for this Site yet."}</Typography> : null}
      {result?.results.length ? <Box component="ul" aria-label="Published documents" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 2 }}>
      {result.results.map(document => <Box component="li" key={document.id} sx={{ minWidth: 0 }}><Card variant="outlined" sx={{ height: "100%", "&:focus-within": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 } }}><CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, height: "100%", boxSizing: "border-box" }}>
        <Box component="span" role="img" aria-label={`${FILE_TYPES[document.file_type]} file`} sx={{ width: 46, height: 56, border: 1, borderColor: "primary.main", borderRadius: 1, color: "primary.main", bgcolor: "action.hover", display: "inline-flex", alignItems: "flex-end", justifyContent: "center", pb: 0.6, boxSizing: "border-box", fontSize: "0.7rem", fontWeight: 800, position: "relative", "&::before": { content: '""', position: "absolute", right: 0, top: 0, width: 11, height: 11, bgcolor: "background.paper", borderLeft: 1, borderBottom: 1, borderColor: "primary.main", borderBottomLeftRadius: 1 } }}>{FILE_TYPES[document.file_type]}</Box>
        <Typography variant="h2" component="h2" sx={{ fontSize: "1.3rem", fontWeight: 650 }}>{document.title}</Typography>
        {document.description ? <Typography>{document.description}</Typography> : null}
        <Typography variant="body2" color="text.secondary">{document.categories.map(item => item.name).join(", ")}{document.version ? ` · Version ${document.version}` : ""}{document.effective_date ? ` · Effective ${document.effective_date}` : ""}</Typography>
        <Link href={document.file_url} underline="always" sx={{ mt: "auto", minHeight: 44, display: "inline-flex", alignItems: "center", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 } }} aria-label={`Download ${document.title}`}>Download {document.require_login_to_download ? "(sign in required)" : FILE_TYPES[document.file_type]}</Link>
      </CardContent></Card></Box>)}
      </Box> : null}
      {result && result.count > 0 ? <Box component="nav" aria-label="Document pagination" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Button disabled={!result.previous} onClick={() => navigate(page - 1)}>Previous page</Button>
        <Typography role="status">Page {page} · {result.count} documents</Typography>
        <Button disabled={!result.next} onClick={() => navigate(page + 1)}>Next page</Button>
      </Box> : null}
    </>}
  </Box>;
}
