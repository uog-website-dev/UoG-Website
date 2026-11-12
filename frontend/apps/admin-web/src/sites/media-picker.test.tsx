import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import Button from "@mui/material/Button";

const { listSiteMedia, getMediaUploadPolicy, getSiteMedia, updateSiteMedia, getMediaReferences, removeSiteMedia } = vi.hoisted(() => ({
  listSiteMedia: vi.fn(),
  getMediaUploadPolicy: vi.fn(),
  getSiteMedia: vi.fn(),
  updateSiteMedia: vi.fn(),
  getMediaReferences: vi.fn(),
  removeSiteMedia: vi.fn(),
}));

vi.mock("@/app/sites/media-actions", () => ({
  listSiteMedia,
  getMediaUploadPolicy,
  getSiteMedia,
  updateSiteMedia,
  getMediaReferences,
  removeSiteMedia,
}));

import { MediaPickerDialog, type MediaPickerResult } from "./media-picker";
import { SiteImageField } from "./site-image-field";
import {
  MediaBlockEditor,
  parseMediaBlock,
  type SliderBlockValue,
} from "./content-media-builder";

const ready = {
  id: "11111111-1111-4111-8111-111111111111",
  site: 11,
  original_filename: "campus.png",
  detected_mime: "image/png",
  content_type: "image/png",
  byte_count: 100,
  checksum: "abc",
  status: "READY" as const,
  processing_state: "READY" as const,
  thumbnail_status: "READY" as const,
  thumbnail_url: "/thumb",
  processing_attempts: 1,
  processing_error_code: "",
  width: 800,
  height: 600,
  alt_text: "Campus green",
  created_by: 1,
  updated_by: 1,
  created_at: "2026-11-11T00:00:00Z",
  updated_at: "2026-11-11T00:00:00Z",
};

const second = {
  ...ready,
  id: "22222222-2222-4222-8222-222222222222",
  original_filename: "hall.png",
  alt_text: "Main hall",
};

function page(results: typeof ready[]) {
  return { ok: true as const, data: { count: results.length, next: null, previous: null, results } };
}

beforeEach(() => {
  listSiteMedia.mockResolvedValue(page([ready, second]));
  getMediaUploadPolicy.mockResolvedValue({ ok: true, data: { image_max_bytes: 1, text_max_bytes: 1, pdf_max_bytes: 1, mime_types: ["image/png"] } });
  getSiteMedia.mockImplementation(async (_site: number, id: string) => ({
    ok: true,
    data: id === second.id ? second : ready,
  }));
  updateSiteMedia.mockResolvedValue({ ok: true, data: ready });
  getMediaReferences.mockResolvedValue({ ok: true, data: { asset_id: ready.id, references: [] } });
  removeSiteMedia.mockResolvedValue({ ok: true, data: { asset_id: ready.id, state: "QUEUED" } });
});

function PickerHarness({ onConfirm }: { onConfirm: (result: MediaPickerResult) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <Button ref={ref} onClick={() => setOpen(true)}>Open picker</Button>
      <MediaPickerDialog
        open={open}
        siteId={11}
        returnFocusRef={ref}
        onCancel={() => setOpen(false)}
        onConfirm={(result) => { onConfirm(result); setOpen(false); }}
      />
    </>
  );
}

describe("MediaPickerDialog", () => {
  it("filters, selects a ready Site asset and returns a stable asset ID payload", async () => {
    const onConfirm = vi.fn();
    render(<PickerHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    expect(await screen.findByRole("dialog", { name: "Choose a ready image" })).toBeTruthy();
    await waitFor(() => expect(listSiteMedia).toHaveBeenCalledWith(11, expect.objectContaining({ ready_images: true })));
    const search = await screen.findByLabelText("Search media");
    fireEvent.change(search, { target: { value: "campus" } });
    fireEvent.click(screen.getByRole("button", { name: "Search media" }));
    await waitFor(() => expect(listSiteMedia).toHaveBeenCalledWith(11, expect.objectContaining({ search: "campus", ready_images: true })));
    fireEvent.click(await screen.findByRole("button", { name: "Select campus.png" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      assetId: ready.id,
      originalFilename: "campus.png",
      altText: "Campus green",
    })));
    expect(getSiteMedia).toHaveBeenCalledWith(11, ready.id);
  });

  it("Escape cancels without change and returns focus to the invoking control", async () => {
    const onConfirm = vi.fn();
    render(<PickerHarness onConfirm={onConfirm} />);
    const invoke = screen.getByRole("button", { name: "Open picker" });
    invoke.focus();
    fireEvent.click(invoke);
    const dialog = await screen.findByRole("dialog", { name: "Choose a ready image" });
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a ready image" })).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(invoke));
  });

  it("keeps the draft selection when confirm finds the asset ineligible", async () => {
    getSiteMedia.mockResolvedValue({
      ok: true,
      data: { ...ready, status: "REJECTED", processing_state: "FAILED", thumbnail_status: "FAILED" },
    });
    const onConfirm = vi.fn();
    render(<PickerHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select campus.png" }));
    expect(await screen.findByText(/no longer an eligible ready image/i)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Choose a ready image" })).toBeTruthy();
  });
});

describe("SiteImageField and repeater builder", () => {
  it("changes only the targeted Slider slide and restores focus after picking", async () => {
    const onChange = vi.fn();
    const value: SliderBlockValue = {
      type: "slider",
      id: "hero",
      slides: [
        { id: "slide-1", asset_id: ready.id, alt: "Campus green" },
        { id: "slide-2", asset_id: second.id, alt: "Main hall" },
      ],
    };
    function Harness() {
      const [current, setCurrent] = useState(value);
      return (
        <MediaBlockEditor
          siteId={11}
          value={current}
          onChange={(next) => {
            onChange(next);
            setCurrent(next as SliderBlockValue);
          }}
        />
      );
    }
    render(<Harness />);
    // Second Change image belongs to slide 2.
    const changeButtons = screen.getAllByRole("button", { name: "Change image" });
    expect(changeButtons).toHaveLength(2);
    changeButtons[1]!.focus();
    fireEvent.click(changeButtons[1]!);
    fireEvent.click(await screen.findByRole("button", { name: "Select campus.png" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0] as SliderBlockValue;
    expect(next.slides[0]).toEqual(value.slides[0]);
    expect(next.slides[1]?.asset_id).toBe(ready.id);
    await waitFor(() => expect(document.activeElement).toBe(changeButtons[1]));
  });

  it("keeps separate slide references after reorder and reopen", async () => {
    function Harness() {
      const [current, setCurrent] = useState<SliderBlockValue>({
        type: "slider",
        id: "hero",
        slides: [
          { id: "slide-1", asset_id: ready.id, alt: "Campus green" },
          { id: "slide-2", asset_id: second.id, alt: "Main hall" },
        ],
      });
      return <MediaBlockEditor siteId={11} value={current} onChange={(next) => setCurrent(next as SliderBlockValue)} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Move slide 2 up" }));
    expect(screen.getByText("Asset ID: 22222222-2222-4222-8222-222222222222")).toBeTruthy();
    expect(screen.getByText("Asset ID: 11111111-1111-4111-8111-111111111111")).toBeTruthy();
    const changeButtons = screen.getAllByRole("button", { name: "Change image" });
    fireEvent.click(changeButtons[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Choose a ready image" });
    expect(within(dialog).getByRole("button", { name: "Select hall.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a ready image" })).toBeNull());
    expect(screen.getByText("Asset ID: 22222222-2222-4222-8222-222222222222")).toBeTruthy();
    expect(screen.getByText("Asset ID: 11111111-1111-4111-8111-111111111111")).toBeTruthy();
  });

  it("shows an eligibility error on the field while preserving the draft selection", async () => {
    getSiteMedia.mockResolvedValue({
      ok: true,
      data: { ...ready, status: "ARCHIVED", processing_state: "ARCHIVED", thumbnail_status: "UNAVAILABLE" },
    });
    const onChange = vi.fn();
    render(
      <SiteImageField
        siteId={11}
        label="Image"
        value={{ assetId: ready.id, alt: "Draft alt kept" }}
        onChange={onChange}
      />,
    );
    expect(await screen.findByText(/no longer eligible/i)).toBeTruthy();
    expect(screen.getByDisplayValue("Draft alt kept")).toBeTruthy();
    expect(screen.getByText(`Asset ID: ${ready.id}`)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});


describe("Media picker audit regressions", () => {
  it.each(["cancel", "site", "unmount"])("ignores pending confirmation after %s", async (change) => {
    let resolve!: (value: unknown) => void;
    getSiteMedia.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const apply = vi.fn(); const cancel = vi.fn();
    const view = render(<MediaPickerDialog open siteId={11} onCancel={cancel} onConfirm={apply} />);
    fireEvent.click(await screen.findByRole("button", { name: "Select campus.png" }));
    await waitFor(() => expect(getSiteMedia).toHaveBeenCalled());
    if (change === "cancel") {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
      expect(cancel).toHaveBeenCalled();
      view.rerender(<MediaPickerDialog open={false} siteId={11} onCancel={cancel} onConfirm={apply} />);
    } else if (change === "site") view.rerender(<MediaPickerDialog open siteId={22} onCancel={cancel} onConfirm={apply} />);
    else view.unmount();
    await act(async () => resolve({ ok: true, data: ready }));
    expect(apply).not.toHaveBeenCalled();
  });

  it("reports a rejected confirmation request and allows retry", async () => {
    getSiteMedia.mockRejectedValueOnce(new Error("Network unavailable"));
    const apply = vi.fn();
    render(<MediaPickerDialog open siteId={11} onCancel={vi.fn()} onConfirm={apply} />);
    fireEvent.click(await screen.findByRole("button", { name: "Select campus.png" }));
    await screen.findByText(/image could not be verified/);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Select campus.png" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
  });

  it("retains the caption when editing an existing Image", async () => {
    const original = { type: "image", id: "photo", ref: `sites/11/assets/${ready.id}`, alt: "Campus", caption: "Photograph credit" };
    const parsed = parseMediaBlock(original);
    expect(parsed?.type).toBe("image");
    const save = vi.fn();
    render(<MediaBlockEditor siteId={11} value={parsed!} onChange={save} />);
    fireEvent.change(screen.getByLabelText("Image alt text"), { target: { value: "Updated description" } });
    expect(save).toHaveBeenCalledWith({ ...original, alt: "Updated description" });
  });
});
