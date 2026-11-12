import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { listSiteMedia, getMediaUploadPolicy, getSiteMedia, updateSiteMedia, getMediaReferences, removeSiteMedia } = vi.hoisted(() => ({ listSiteMedia: vi.fn(), getMediaUploadPolicy: vi.fn(), getSiteMedia: vi.fn(), updateSiteMedia: vi.fn(), getMediaReferences: vi.fn(), removeSiteMedia: vi.fn() }));
vi.mock("@/app/sites/media-actions", () => ({ listSiteMedia, getMediaUploadPolicy, getSiteMedia, updateSiteMedia, getMediaReferences, removeSiteMedia }));
import { MediaLibrary } from "./media-library";
const asset = { id: "asset-1", site: 11, original_filename: "campus.png", detected_mime: "image/png", status: "READY", processing_state: "READY", byte_count: 100, alt_text: "Campus", content_type: "image/png", thumbnail_status: "NOT_GENERATED", updated_at: "2026-11-11T00:00:00Z" };
const galleryRef = { id: "ref-1", scope: "PUBLIC" as const, page_id: "page-1", revision_id: 3, publication_id: 2, node_id: "gallery-1", field_path: "images.asset", repeater_item_id: "image-1", detachable: true };
const page = (results: unknown[]) => ({ ok: true, data: { count: results.length, next: null, previous: null, results } });
beforeEach(() => {
  vi.clearAllMocks();
  getMediaReferences.mockResolvedValue({ ok: true, data: { asset_id: asset.id, references: [] } });
  removeSiteMedia.mockResolvedValue({ ok: true, data: { asset_id: asset.id, state: "QUEUED" } });
  listSiteMedia.mockResolvedValue(page([]));
  getSiteMedia.mockResolvedValue({ ok: true, data: asset });
  updateSiteMedia.mockResolvedValue({ ok: true, data: { ...asset, alt_text: "New campus description" } });
  getMediaUploadPolicy.mockResolvedValue({ ok: true, data: { image_max_bytes: 20971520, text_max_bytes: 5242880, pdf_max_bytes: 20971520, mime_types: ["image/png", "application/pdf", "text/plain"] } });
});
afterEach(() => vi.restoreAllMocks());
describe("MediaLibrary", () => {
  it("excludes processing images then picks the worker-completed identity on refresh", async () => {
    const select = vi.fn();
    let poll: (() => void) | undefined;
    const originalTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void, delay: number) => { if (delay === 5000) { poll = callback; return 1; } return originalTimeout(callback, delay); }) as typeof window.setTimeout);
    // Defense in depth: the server endpoint already filters pending assets.
    listSiteMedia.mockResolvedValue(page([{ ...asset, status: "PENDING", processing_state: "PROCESSING" }]));
    render(<MediaLibrary siteId={11} canUpload={false} onSelect={select} imagesOnly />);
    await screen.findByText("No ready media found.");
    expect(screen.queryByRole("button", { name: "Select campus.png" })).toBeNull();
    await waitFor(() => expect(poll).toBeTypeOf("function"));
    listSiteMedia.mockResolvedValue(page([asset, { ...asset, id: "pdf-1", original_filename: "report.pdf", detected_mime: "application/pdf" }]));
    await act(async () => { poll?.(); });
    fireEvent.click(await screen.findByRole("button", { name: "Select campus.png" }));
    expect(select).toHaveBeenCalledWith(asset);
    expect(screen.queryByText("report.pdf")).toBeNull();
    expect(listSiteMedia).toHaveBeenCalledWith(11, { page: 1, ready_images: true });
  });
  it("shows processing state in the library and preserves the retry key after transfer failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Interrupted" }), { status: 503 }));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...asset, status: "PENDING", processing_state: "PROCESSING" }), { status: 202 }));
    render(<MediaLibrary siteId={11} canUpload />);
    const input = await screen.findByLabelText("Upload media file");
    fireEvent.change(input, { target: { files: [new File(["image"], "campus.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    await screen.findByText(/Interrupted/);
    fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
    await screen.findByText(/Upload finished/);
    const options = fetch.mock.calls.map((call) => call[1]);
    expect((options[0]?.headers as Record<string, string>)["Idempotency-Key"]).toBe((options[1]?.headers as Record<string, string>)["Idempotency-Key"]);
    expect(fetch.mock.calls[0]?.[0]).toBe("/admin/sites/11/media-upload?filename=campus.png");
  });

  it("keeps the selected file after a failed upload and never invents a ready row", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Interrupted transfer" } }), { status: 503 }));
    listSiteMedia.mockResolvedValue(page([]));
    render(<MediaLibrary siteId={11} canUpload />);
    fireEvent.change(await screen.findByLabelText("Upload media file"), { target: { files: [new File(["image"], "campus.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    expect(await screen.findByText(/Interrupted transfer/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Media name for campus.png" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry upload" })).toBeTruthy();
    expect(screen.getByText("0 of 1 files added")).toBeTruthy();
    expect(listSiteMedia).not.toHaveBeenCalledWith(11, expect.objectContaining({ status: "READY" }));
  });
  it("never offers upload to a read-only account", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    render(<MediaLibrary siteId={11} canUpload={false} />);
    await screen.findByText("campus.png");
    expect(screen.queryByLabelText("Upload media file")).toBeNull();
    expect(getMediaUploadPolicy).not.toHaveBeenCalled();
  });
  it("applies filename search before paging and resets to the first page", async () => {
    listSiteMedia.mockResolvedValue({ ok: true, data: { count: 21, next: "?page=2", previous: null, results: [asset] } });
    render(<MediaLibrary siteId={11} canUpload={false} />);
    await screen.findByText("campus.png");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 2 }));
    fireEvent.change(screen.getByLabelText("Search media"), { target: { value: "campus" } });
    fireEvent.submit(screen.getByRole("search", { name: "Search Site media" }));
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 1, search: "campus" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 1 }));
  });

  it("loads scoped details and saves only persisted alt text", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    render(<MediaLibrary siteId={11} canUpload />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    const field = await screen.findByLabelText("Alt text");
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("Campus"));
    expect(screen.getByText("Thumbnail: not generated")).toBeTruthy();
    fireEvent.change(field, { target: { value: "New campus description" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved.");
    expect(getSiteMedia).toHaveBeenCalledWith(11, "asset-1");
    expect(updateSiteMedia).toHaveBeenCalledWith(11, "asset-1", { alt_text: "New campus description" });
  });

  it("shows readonly metadata without a save control", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    render(<MediaLibrary siteId={11} canUpload={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    const field = await screen.findByLabelText("Alt text");
    expect((field as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("sends the selected status and type filters to the server", async () => {
    render(<MediaLibrary siteId={11} canUpload={false} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Media status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Ready" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Media type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Images" }));
    fireEvent.click(screen.getByRole("button", { name: "Search media" }));
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 1, search: "", status: "READY", type: "image" }));
  });

  it("shows scoped thumbnails and disables a broken preview until retry", async () => {
    listSiteMedia.mockResolvedValue(page([{ ...asset, thumbnail_status: "READY", thumbnail_url: "/internal-api-link" }]));
    render(<MediaLibrary siteId={11} canUpload={false} onSelect={vi.fn()} imagesOnly />);
    const image = await screen.findByRole("img", { name: "Campus" });
    expect(image.getAttribute("src")).toBe("/admin/sites/11/media/asset-1/image?variant=thumbnail");
    fireEvent.error(image);
    expect(await screen.findByText("Preview unavailable. Refresh to retry.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Select campus.png" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh media" }));
    await waitFor(() => expect(screen.queryByText("Preview unavailable. Refresh to retry.")).toBeNull());
  });

  it("reports terminal image processing without offering selection", async () => {
    listSiteMedia.mockResolvedValue(page([{ ...asset, status: "REJECTED", processing_state: "FAILED", thumbnail_status: "FAILED", processing_error_code: "PROCESSING_IO", thumbnail_url: null }]));
    const view = render(<MediaLibrary siteId={11} canUpload={false} />);
    expect(await screen.findByText("Processing failed: PROCESSING_IO.")).toBeTruthy();
    view.unmount();
    render(<MediaLibrary siteId={11} canUpload={false} onSelect={vi.fn()} imagesOnly />);
    await screen.findByText("No ready media found.");
    expect(screen.queryByRole("button", { name: "Select campus.png" })).toBeNull();
  });

  it("blocks deletion for a live reference and confirms unused removal", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    getMediaReferences.mockResolvedValueOnce({ ok: true, data: { asset_id: asset.id, references: [galleryRef] } });
    const view = render(<MediaLibrary siteId={11} canUpload={false} canDelete />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    await screen.findByText(/References: 1/);
    expect(await screen.findByText("This asset is in use and cannot be deleted.")).toBeTruthy();
    expect(screen.getByText("PUBLIC: gallery-1 / images.asset / image-1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete unused asset" }) as HTMLButtonElement).disabled).toBe(true);
    expect(removeSiteMedia).not.toHaveBeenCalled();
    expect(screen.getAllByText("campus.png").length).toBeGreaterThan(0);
    view.unmount();
    render(<MediaLibrary siteId={11} canUpload={false} canDelete />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    await screen.findByText(/References: 0/);
    fireEvent.click(screen.getByRole("button", { name: "Delete unused asset" }));
    expect(removeSiteMedia).not.toHaveBeenCalled();
    listSiteMedia.mockResolvedValue(page([]));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(removeSiteMedia).toHaveBeenCalledWith(11, asset.id));
    await screen.findByText("No media found.");
  });

  it("keeps the library card and metadata after a delete conflict", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    getMediaReferences.mockResolvedValue({ ok: true, data: { asset_id: asset.id, references: [] } });
    removeSiteMedia.mockResolvedValue({
      ok: false,
      error: { status: 409, code: "conflict", message: "Asset is still referenced by a draft, publication or placement.", details: null, requestId: null },
    });
    render(<MediaLibrary siteId={11} canUpload={false} canDelete />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    await screen.findByText(/References: 0/);
    fireEvent.click(screen.getByRole("button", { name: "Delete unused asset" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText(/in use by a draft, publication or nested placement/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm deletion" })).toBeNull();
    expect(screen.getAllByText("campus.png").length).toBeGreaterThan(0);
    expect(screen.getByText("Alt text: Campus")).toBeTruthy();
    expect((screen.getByLabelText("Alt text") as HTMLInputElement).value).toBe("Campus");
  });

  it("preserves edited alt text after a recoverable save failure", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    updateSiteMedia.mockResolvedValue({
      ok: false,
      error: { status: 503, code: "service_unavailable", message: "Connection interrupted", details: null, requestId: null },
    });
    render(<MediaLibrary siteId={11} canUpload />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    const field = await screen.findByLabelText("Alt text");
    fireEvent.change(field, { target: { value: "Draft campus description" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Connection interrupted")).toBeTruthy();
    expect((screen.getByLabelText("Alt text") as HTMLInputElement).value).toBe("Draft campus description");
  });

  it("keeps a Gallery-referenced asset, saves alt text, and reloads persisted details", async () => {
    const updated = { ...asset, alt_text: "Campus gallery hero" };
    listSiteMedia.mockResolvedValue(page([asset]));
    getMediaReferences.mockResolvedValue({ ok: true, data: { asset_id: asset.id, references: [galleryRef] } });
    getSiteMedia.mockResolvedValue({ ok: true, data: asset });
    updateSiteMedia.mockResolvedValue({ ok: true, data: updated });
    const view = render(<MediaLibrary siteId={11} canUpload canDelete />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    expect(await screen.findByText("This asset is in use and cannot be deleted.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete unused asset" }) as HTMLButtonElement).disabled).toBe(true);
    const field = await screen.findByLabelText("Alt text");
    fireEvent.change(field, { target: { value: "Campus gallery hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved.");
    expect(updateSiteMedia).toHaveBeenCalledWith(11, asset.id, { alt_text: "Campus gallery hero" });
    listSiteMedia.mockResolvedValue(page([updated]));
    getSiteMedia.mockResolvedValue({ ok: true, data: updated });
    view.unmount();
    render(<MediaLibrary siteId={11} canUpload canDelete />);
    expect(await screen.findByText("Alt text: Campus gallery hero")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details for campus.png" }));
    await waitFor(() => expect((screen.getByLabelText("Alt text") as HTMLInputElement).value).toBe("Campus gallery hero"));
  });

  it("keeps deletion disabled if the reference inventory cannot be verified", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    getMediaReferences.mockResolvedValue({ ok: false, error: { message: "Unavailable", status: 503 } });
    render(<MediaLibrary siteId={11} canUpload={false} canDelete />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    await screen.findByText(/temporary transport problem/);
    expect((screen.getByRole("button", { name: "Delete unused asset" }) as HTMLButtonElement).disabled).toBe(true);
    expect(removeSiteMedia).not.toHaveBeenCalled();
  });
});

describe("Site-isolated media browsing", () => {
  it("ignores a delayed Informatics search after switching to Medicine and resets all query state", async () => {
    let resolveSearch!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveSearch = resolve; });
    listSiteMedia.mockImplementation((site: number, query: { search?: string }) => site === 22
      ? Promise.resolve(page([{ ...asset, id: "medicine", site: 22, original_filename: "medicine.png" }]))
      : query.search ? pending : Promise.resolve(page([asset])));
    const view = render(<MediaLibrary siteId={11} canUpload={false} />);
    await screen.findByText("campus.png");
    fireEvent.change(screen.getByLabelText("Search media"), { target: { value: "campus" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 1, search: "campus" }));
    expect(screen.getByText("Loading media…")).toBeTruthy();
    view.rerender(<MediaLibrary siteId={22} canUpload={false} />);
    expect(screen.queryByText("campus.png")).toBeNull();
    expect((screen.getByLabelText("Search media") as HTMLInputElement).value).toBe("");
    await screen.findByText("medicine.png");
    expect(listSiteMedia).toHaveBeenLastCalledWith(22, { page: 1 });
    await act(async () => resolveSearch(page([asset])));
    expect(screen.queryByText("campus.png")).toBeNull();
    expect(screen.getByText("medicine.png")).toBeTruthy();
    expect(screen.getByText(/1 assets · Page 1/)).toBeTruthy();
  });

  it("uses responsive grid columns and keeps list layout usable", async () => {
    listSiteMedia.mockResolvedValue(page([asset]));
    render(<MediaLibrary siteId={11} canUpload={false} />);
    const list = await screen.findByRole("list", { name: "Site media assets" });
    expect(getComputedStyle(list).display).toBe("grid");
    expect(list).toHaveProperty("style");
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("listitem")).toBeTruthy();
  });

  it("offers recovery for empty search and transport failure", async () => {
    const user = userEvent.setup();
    render(<MediaLibrary siteId={11} canUpload={false} />);
    await screen.findByText("No media found.");
    fireEvent.change(screen.getByLabelText("Search media"), { target: { value: "missing" } });
    fireEvent.submit(screen.getByRole("search"));
    const showAll = await screen.findByRole("button", { name: "Show all media" });
    showAll.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 1 }));
    listSiteMedia.mockResolvedValue({ ok: false, error: { message: "Connection interrupted", status: 503 } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh media" }));
    await screen.findByText(/Media could not be loaded/);
    expect(screen.queryByText("No media found.")).toBeNull();
    listSiteMedia.mockResolvedValue(page([asset]));
    const retry = screen.getByRole("button", { name: "Retry media" });
    retry.focus();
    await user.keyboard(" ");
    await screen.findByText("campus.png");
  });

  it("supports keyboard pagination and grid/list controls", async () => {
    const user = userEvent.setup();
    listSiteMedia.mockResolvedValue({ ok: true, data: { count: 21, next: "?page=2", previous: null, results: [asset] } });
    render(<MediaLibrary siteId={11} canUpload={false} />);
    await screen.findByText("campus.png");
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 2 }));
    const previous = screen.getByRole("button", { name: "Previous" });
    previous.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(listSiteMedia).toHaveBeenLastCalledWith(11, { page: 1 }));
    screen.getByRole("button", { name: "List view" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe("true");
    screen.getByRole("button", { name: "Grid view" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed")).toBe("true");
  });
});


describe("Quiet processing updates and previews", () => {
  it("refreshes a processing image without a loading flash and updates its open details preview", async () => {
    let poll: (() => void) | undefined;
    const original = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
      if (delay === 5000) { poll = callback; return 999; }
      return original(callback, delay);
    }) as typeof window.setTimeout);
    const pending = { ...asset, status: "PENDING", processing_state: "PROCESSING", thumbnail_status: "PROCESSING", thumbnail_url: null };
    listSiteMedia.mockResolvedValue(page([pending]));
    getSiteMedia.mockResolvedValue({ ok: true, data: pending });
    render(<MediaLibrary siteId={11} canUpload={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
    await screen.findByText("Thumbnail: processing");
    expect(screen.queryByRole("img")).toBeNull();
    let resolve!: (value: unknown) => void;
    listSiteMedia.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    act(() => poll?.());
    expect(screen.queryByText("Loading media?")).toBeNull();
    expect(screen.getByRole("list", { name: "Site media assets", hidden: true }).getAttribute("aria-busy")).toBe("false");
    await act(async () => resolve(page([{ ...asset, thumbnail_status: "READY", thumbnail_url: "/private" }])));
    await screen.findByText("Thumbnail: ready");
    const images = screen.getAllByRole("img", { hidden: true });
    expect(images.some(img => img.getAttribute("src")?.endsWith("?variant=display"))).toBe(true);
    expect(images.some(img => img.getAttribute("src")?.endsWith("?variant=thumbnail"))).toBe(true);
    expect(screen.queryByText("Loading media?")).toBeNull();
  });

  it("does not continuously poll a completed catalog", async () => {
    const timers = vi.spyOn(window, "setTimeout");
    listSiteMedia.mockResolvedValue(page([asset]));
    render(<MediaLibrary siteId={11} canUpload={false} />);
    await screen.findByText("campus.png");
    expect(timers.mock.calls.filter(call => call[1] === 5000)).toHaveLength(0);
  });
});

it("renames and categorizes an asset without changing its original filename", async () => {
  const updated = { ...asset, display_name: "Campus festival", categories: ["Campus", "Events"] };
  listSiteMedia.mockResolvedValue(page([asset]));
  updateSiteMedia.mockResolvedValue({ ok: true, data: updated });
  render(<MediaLibrary siteId={11} canUpload />);
  fireEvent.click(await screen.findByRole("button", { name: "Details for campus.png" }));
  const name = await screen.findByLabelText("Media name");
  await waitFor(() => expect((name as HTMLInputElement).value).toBe("campus.png"));
  fireEvent.change(name, { target: { value: "Campus festival" } });
  fireEvent.change(screen.getByLabelText("Categories"), { target: { value: "Campus, Events" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Changes saved.");
  expect(updateSiteMedia).toHaveBeenCalledWith(11, "asset-1", { display_name: "Campus festival", categories: ["Campus", "Events"] });
  expect((screen.getByLabelText("Media name") as HTMLInputElement).value).toBe("Campus festival");
  expect(screen.getAllByText("campus.png").length).toBeGreaterThan(0);
});

it("opens the scoped display image in an immersive viewer and clears it on Site change", async () => {
  listSiteMedia.mockResolvedValue(page([asset]));
  const view = render(<MediaLibrary siteId={11} canUpload={false} />);
  fireEvent.click(await screen.findByRole("button", {name:"Preview campus.png"}));
  const viewer = await screen.findByRole("dialog", {name:"campus.png"});
  expect(viewer.querySelector("img")?.getAttribute("src")).toBe("/admin/sites/11/media/asset-1/image?variant=display");
  expect(screen.getByRole("button", {name:"Close image preview"})).toBeTruthy();
  listSiteMedia.mockResolvedValue(page([]));
  view.rerender(<MediaLibrary siteId={22} canUpload={false} />);
  await screen.findByText("No media found.");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps unsaved metadata when expanding and closing the image", async () => {
  listSiteMedia.mockResolvedValue(page([asset]));
  render(<MediaLibrary siteId={11} canUpload />);
  fireEvent.click(await screen.findByRole("button", {name:"Details for campus.png"}));
  const field = await screen.findByLabelText("Media name");
  await waitFor(()=>expect((field as HTMLInputElement).value).toBe("campus.png"));
  fireEvent.change(field,{target:{value:"Unsaved name"}});
  fireEvent.click(screen.getByRole("button",{name:"Expand image"}));
  fireEvent.click(await screen.findByRole("button",{name:"Close image preview"}));
  await waitFor(()=>expect((screen.getByLabelText("Media name") as HTMLInputElement).value).toBe("Unsaved name"));
  expect(updateSiteMedia).not.toHaveBeenCalled();
});

it("hides ready badges in both layouts while keeping processing visible",async()=>{
 listSiteMedia.mockResolvedValue(page([asset,{...asset,id:"pending",original_filename:"pending.png",status:"PENDING",processing_state:"PROCESSING"}]));
 render(<MediaLibrary siteId={11} canUpload={false}/>);
 await screen.findByText("campus.png");
 expect(screen.queryByText("READY")).toBeNull();
 expect(screen.getByText("PROCESSING")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"List view"}));
 expect(screen.queryByText("READY")).toBeNull();
 expect(screen.getByRole("button",{name:"Preview campus.png"}).querySelector("img")?.getAttribute("src")).toContain("/sites/11/media/asset-1/image?variant=thumbnail");
 expect(screen.getByText("PROCESSING")).toBeTruthy();
});
