import { fireEvent, render, screen, waitFor, within } from "@/test/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

const { push, params } = vi.hoisted(() => ({ push: vi.fn(), params: { documentId: undefined as string | undefined } }));
const listSiteDocuments = vi.fn();
const listSiteDocumentCategories = vi.fn();
const getSiteDocument = vi.fn();
const saveSiteDocument = vi.fn();
const createSiteDocumentCategory = vi.fn();
const manageSiteDocument = vi.fn();

vi.mock("@/app/sites/document-actions", () => ({
  listSiteDocuments: (...args: unknown[]) => listSiteDocuments(...args),
  listSiteDocumentCategories: (...args: unknown[]) => listSiteDocumentCategories(...args),
  getSiteDocument: (...args: unknown[]) => getSiteDocument(...args),
  saveSiteDocument: (...args: unknown[]) => saveSiteDocument(...args),
  createSiteDocumentCategory: (...args: unknown[]) => createSiteDocumentCategory(...args),
  manageSiteDocument: (...args: unknown[]) => manageSiteDocument(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (...args: unknown[]) => push(...args) }), useParams: () => params, usePathname: () => "/sites/11/admin/documents" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/dynamic", () => ({ default: () => function EditorMock({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <textarea aria-label="Description" value={value} onChange={(event) => onChange(event.target.value)} />; } }));
vi.mock("@/sites/lazy-media-picker", () => ({ LazyMediaPickerDialog: ({ open, onSelect }: { open: boolean; onSelect: (asset: { id: string; original_filename: string; detected_mime: string; byte_count: number; created_at: string; updated_at: string; site: number; storage_reference: string; checksum: string; status: string }) => void }) => open ? <button onClick={() => onSelect({ id: "asset-1", original_filename: "policy.pdf", detected_mime: "application/pdf", byte_count: 10, created_at: "2026-01-01", updated_at: "2026-01-01", site: 11, storage_reference: "bucket:key", checksum: "abc", status: "READY" })}>Choose policy.pdf</button> : null }));
vi.mock("@/sites/media-library", () => ({ MediaLibrary: ({ onSelect }: { onSelect: (asset: { id: string; original_filename: string; detected_mime: string; byte_count: number; created_at: string; updated_at: string; site: number; storage_reference: string; checksum: string; status: string }) => void }) => <button onClick={() => onSelect({ id: "asset-1", original_filename: "policy.pdf", detected_mime: "application/pdf", byte_count: 10, created_at: "2026-01-01", updated_at: "2026-01-01", site: 11, storage_reference: "bucket:key", checksum: "abc", status: "READY" })}>Choose policy.pdf</button> }));

import { SiteDocuments, SiteDocumentEditor } from "./site-documents";
import { SiteAdminFrame } from "./site-admin-frame";

const permissions = ["content.documents.view", "content.documents.create", "content.documents.update", "content.documents.publish", "content.documents.delete", "content.media.view"];
const doc = (partial: Record<string, unknown> = {}) => ({ id: "doc-1", site: 11, title: "Policy", slug: "policy", description: "<p>Current policy</p>", file_reference: "sites/11/assets/asset-1", file_type: "application/pdf", categories: [], status: "DRAFT", visibility: "PUBLIC", version: "1", effective_date: null, published_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", revision_number: 1, ...partial });
const ok = <T,>(data: T) => ({ ok: true as const, data });
function frame(children: React.ReactNode, access = permissions) { return <ToastProvider><SiteAdminFrame site={{ id: 11, name: "Informatics", code: "INFO", status: "ACTIVE" }} enabledModuleCodes={["DOCUMENTS", "MEDIA"]} permissions={access}>{children}</SiteAdminFrame></ToastProvider>; }

beforeEach(() => {
  push.mockReset(); params.documentId = undefined;
  listSiteDocuments.mockReset().mockResolvedValue(ok({ count: 0, next: null, previous: null, results: [] }));
  listSiteDocumentCategories.mockReset().mockResolvedValue(ok([]));
  getSiteDocument.mockReset().mockResolvedValue(ok(doc()));
  saveSiteDocument.mockReset().mockImplementation(async (_site: number, input: Record<string, unknown>, id?: string) => ok(doc({ ...input, id: id ?? "doc-1" })));
  createSiteDocumentCategory.mockReset(); manageSiteDocument.mockReset();
});

describe("Site Documents create-edit-list flow", () => {
  it("opens the complete form, saves a draft, edits the same record, then lists it", async () => {
    const editor = render(frame(<SiteDocumentEditor />));
    expect(await screen.findByRole("heading", { name: "Add New Document" })).toBeTruthy();
    for (const section of ["Document Title", "File Upload", "Description", "Categories", "Publish Settings", "Document Meta"]) expect(screen.getByRole("heading", { name: section })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Document Title" }), { target: { value: "Policy" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Policy details" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose or upload a file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose policy.pdf" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a document file" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(saveSiteDocument).toHaveBeenCalledWith(11, expect.objectContaining({ title: "Policy", slug: "policy", description: "Policy details", file_reference: "sites/11/assets/asset-1" }), undefined));
    expect(push).toHaveBeenCalledWith("/sites/11/admin/documents");

    editor.unmount(); params.documentId = "doc-1";
    const edit = render(frame(<SiteDocumentEditor />));
    expect(await screen.findByRole("heading", { name: "Edit Document" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Document Title" }), { target: { value: "Policy Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(saveSiteDocument).toHaveBeenLastCalledWith(11, expect.objectContaining({ title: "Policy Updated" }), "doc-1"));
    edit.unmount(); params.documentId = undefined;
    listSiteDocuments.mockResolvedValue(ok({ count: 1, next: null, previous: null, results: [doc({ title: "Policy Updated" })] }));
    render(frame(<SiteDocuments />));
    const table = await screen.findByRole("table", { name: "Site documents" });
    expect(within(table).getByText("Policy Updated")).toBeTruthy();
    expect(within(table).getByText("PDF")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Edit Policy Updated" }).getAttribute("href")).toBe("/sites/11/admin/documents/doc-1/edit");
    expect(listSiteDocuments).toHaveBeenCalledWith(11, expect.objectContaining({ page: 1, page_size: 20 }));
  });

  it("rejects an empty title in the form", async () => {
    render(frame(<SiteDocumentEditor />));
    const title = await screen.findByRole("textbox", { name: "Document Title" });
    fireEvent.change(title, { target: { value: "" } });
    expect((title as HTMLInputElement).required).toBe(true);
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", true);
    saveSiteDocument.mockClear();
    expect(saveSiteDocument).not.toHaveBeenCalled();
  });

  it("hides create, edit, and delete controls from a read-only Site user", async () => {
    listSiteDocuments.mockResolvedValue(ok({ count: 1, next: null, previous: null, results: [doc()] }));
    render(frame(<SiteDocuments />, ["content.documents.view"]));
    const table = await screen.findByRole("table", { name: "Site documents" });
    expect(screen.queryByRole("link", { name: "Add New Document" })).toBeNull();
    expect(within(table).queryByRole("link", { name: "Edit Policy" })).toBeNull();
    expect(within(table).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(table).getByRole("link", { name: "Preview Policy" })).toBeTruthy();
  });
});
