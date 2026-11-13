import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { validateVisualLayout, widgetRegistry, adaptLegacyBlocks } from "@uog/types";
import type { VisualLayout, WidgetNode } from "@uog/types";
import fixtures from "../../types/src/layout/fixtures.json";
import { PublicPageView, pageFromResponse } from "./public-page";

const DYNAMIC_FALLBACK = new Set([
  "lottie_player","blog","recent_posts","post_carousel","taxonomy",
  "breadcrumbs","loop_carousel","table_of_contents",
]);

function structureSignature(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-node-id],[data-widget-type],[data-layout-version]")].map((node) => {
    const el = node as HTMLElement;
    return [
      el.getAttribute("data-layout-version") ?? "",
      el.getAttribute("data-widget-type") ?? "",
      el.getAttribute("data-node-id") ?? "",
    ].join(":");
  });
}

function pageDoc(layout: unknown, title = "Fixture Page") {
  return pageFromResponse(200, { title, site: 11, blocks: [], metadata: { visual_layout: layout } });
}

describe("shared visual layout fixtures",()=>{
  for(const fixture of fixtures)it(fixture.name,()=>{
    const original=JSON.stringify(fixture.layout);
    const result=validateVisualLayout(fixture.layout);
    expect(result.ok).toBe(fixture.valid);
    expect(JSON.stringify(fixture.layout)).toBe(original);
    if(!result.ok)expect(Object.keys(result.errors).every(path=>path.startsWith("metadata.visual_layout"))).toBe(true);
  });
  it("exports exactly the product's 43 typed widgets",()=>expect(new Set(widgetRegistry.map(widget=>widget.type)).size).toBe(43));
  it("renders three ordered columns and the scoped Slider without mutating IDs",()=>{
    const layout=structuredClone(fixtures[0]!.layout);
    const page=pageFromResponse(200,{title:"University",site:11,metadata:{visual_layout:layout},blocks:[]});
    const {container}=render(<PublicPageView page={page}/>);
    expect([...container.querySelectorAll('[data-node-id^="column-"]')].map(node=>node.getAttribute("data-node-id"))).toEqual(["column-1","column-2","column-3"]);
    expect(screen.getByRole("region",{name:"Image slider"})).toBeTruthy();
    expect(screen.getByRole("img",{name:"Campus"}).getAttribute("src")).toContain("/api/v1/site-context/media/00000000-0000-4000-8000-000000000001/");
    expect(screen.getByText("Study and research")).toBeTruthy();
  });
  it("keeps the existing renderer for legacy Pages and fails closed for unknown visual versions",()=>{
    const legacy={title:"Legacy",site:11,blocks:[{type:"heading",level:2,text:"Original body"}]};
    const view=render(<PublicPageView page={pageFromResponse(200,legacy)}/>);
    expect(screen.getByRole("heading",{name:"Original body"})).toBeTruthy();
    view.rerender(<PublicPageView page={pageFromResponse(200,{...legacy,metadata:{visual_layout:{schema_version:99,rows:[]}}})}/>);
    expect(screen.queryByText("Original body")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("unavailable");
  });
  it("imports legacy flat blocks deterministically without editing the source",()=>{
    const legacy=[{type:"heading",id:"existing-id",text:"Welcome",level:2},{type:"paragraph",html:"<p>Old content</p>"}];
    const first=adaptLegacyBlocks(legacy);
    expect(validateVisualLayout(first).ok).toBe(true);
    expect(first).toEqual(adaptLegacyBlocks(legacy));
    expect(first.rows[0]!.columns[0]!.children[0]!.id).toBe("existing-id");
    expect(legacy[1]!.html).toBe("<p>Old content</p>");
  });
  it("rejects duplicate item identity, over-node limits and oversized payloads",()=>{
    const layout=structuredClone(fixtures[0]!.layout) as any;
    const slider=layout.rows[0].columns[1].children[0];
    slider.props.items.push({...slider.props.items[0]});
    expect(validateVisualLayout(layout).ok).toBe(false);
    expect(validateVisualLayout({...layout,rows:Array(50).fill(layout.rows[0])}).ok).toBe(false);
    expect(validateVisualLayout({...layout,unused:"x".repeat(262144)}).ok).toBe(false);
  });
});

it("imports a full 100-block legacy document within the new contract bounds",()=>{
 const source=Array.from({length:100},(_,index)=>({id:`old-${index}`,type:"heading",level:2,text:`Heading ${index}`}));
 const adapted=adaptLegacyBlocks(source);
 expect(validateVisualLayout(adapted).ok).toBe(true);
 expect(adapted.rows.flatMap(row=>row.columns.flatMap(column=>column.children)).map(node=>node.id)).toEqual(source.map(node=>node.id));
});

it("isolates private revision image URLs from public rendering and retries a changed preview",async()=>{
 const page=pageFromResponse(200,{title:"Preview",site:11,blocks:[],metadata:{visual_layout:fixtures[0]!.layout}});
 const view=render(<PublicPageView page={page}/>);
 fireEvent.error(screen.getByRole("img",{name:"Campus"}));
 view.rerender(<PublicPageView page={page} privateMediaBase="/admin/sites/11/pages/page/preview-media/8"/>);
 expect((await screen.findByRole("img",{name:"Campus"})).getAttribute("src")).toContain("/admin/sites/11/pages/page/preview-media/8/");
 view.rerender(<PublicPageView page={page}/>);
 expect(screen.getByRole("img",{name:"Campus"}).getAttribute("src")).toContain("/api/v1/site-context/media/");
});

describe("shared renderer preview/public parity", () => {
  it("produces the same content structure for approved fixtures on both surfaces", () => {
    const approved = fixtures.filter((fixture) => fixture.valid && fixture.name.startsWith("catalog-"));
    expect(approved.length).toBe(43);
    for (const fixture of approved) {
      const page = pageDoc(fixture.layout, fixture.name);
      const publicView = render(<PublicPageView page={page} />);
      const publicStructure = structureSignature(publicView.container);
      publicView.unmount();
      const previewView = render(<PublicPageView page={page} privateMediaBase="/admin/sites/11/media" />);
      expect(structureSignature(previewView.container)).toEqual(publicStructure);
      const type = fixture.name.replace("catalog-", "");
      expect(previewView.container.querySelector(`[data-widget-type="${type}"]`)).toBeTruthy();
      if (DYNAMIC_FALLBACK.has(type)) {
        expect(within(previewView.container).getByRole("status").textContent).toMatch(/unavailable/i);
      }
      previewView.unmount();
    }
  });

  it("keeps Slider, Tabs and Accordion behavior equivalent across surfaces", async () => {
    const user = userEvent.setup();
    const layout: VisualLayout = {
      schema_version: 1,
      rows: [{
        id: "row-interactive",
        type: "section",
        ratios: [100],
        columns: [{
          id: "column-interactive",
          type: "column",
          children: [
            {
              id: "slider-1",
              type: "image_slider",
              props: {
                items: [
                  { id: "s1", asset_id: "00000000-0000-4000-8000-000000000001", alt: "First", caption: "One" },
                  { id: "s2", asset_id: "00000000-0000-4000-8000-000000000002", alt: "Second", caption: "Two" },
                ],
              },
            },
            {
              id: "tabs-1",
              type: "tabs",
              props: {
                items: [
                  { id: "t1", title: "Overview", text: "Overview body" },
                  { id: "t2", title: "Details", text: "Details body" },
                ],
              },
            },
            {
              id: "acc-1",
              type: "accordion",
              props: {
                items: [
                  { id: "a1", title: "Question one", text: "Answer one" },
                  { id: "a2", title: "Question two", text: "Answer two" },
                ],
              },
            },
          ],
        }],
      }],
    };
    const page = pageDoc(layout, "Interactive");
    async function exercise(surface: "public" | "preview") {
      const view = render(
        <PublicPageView
          page={page}
          privateMediaBase={surface === "preview" ? "/admin/sites/11/media" : undefined}
        />,
      );
      expect(screen.getByText("1 of 2")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Next slide" }));
      expect(screen.getByText("2 of 2")).toBeTruthy();
      expect(screen.getByRole("img", { name: "Second" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Overview", selected: true })).toBeTruthy();
      expect(screen.getByText("Overview body")).toBeTruthy();
      const overview = screen.getByRole("tab", { name: "Overview" });
      const details = screen.getByRole("tab", { name: "Details" });
      expect(overview.tabIndex).toBe(0);
      expect(details.tabIndex).toBe(-1);
      overview.focus();
      await user.keyboard("{ArrowRight}");
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Details" }));
      expect(screen.getByRole("tab", { name: "Details" }).tabIndex).toBe(0);
      expect(screen.getByRole("tab", { name: "Overview" }).tabIndex).toBe(-1);
      await user.keyboard("{ArrowLeft}");
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));
      await user.keyboard("{Home}");
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));
      await user.keyboard("{End}");
      expect(screen.getByRole("tab", { name: "Details", selected: true })).toBeTruthy();
      expect(screen.getByText("Details body")).toBeTruthy();
      expect(screen.queryByText("Overview body")).toBeNull();
      const panels = view.container.querySelectorAll("[data-widget='accordion'] details");
      expect(panels).toHaveLength(2);
      expect((panels[0] as HTMLDetailsElement).open).toBe(true);
      fireEvent.click(within(panels[1] as HTMLElement).getByText("Question two"));
      expect((panels[1] as HTMLDetailsElement).open).toBe(true);
      const html = view.container.innerHTML;
      if (surface === "public") {
        expect(html).toContain("/api/v1/site-context/media/");
        expect(html).not.toContain("/admin/sites/");
        expect(html).not.toContain("preview-media");
      } else {
        expect(html).toContain("/admin/sites/11/media/");
        expect(html).not.toContain("/api/v1/site-context/media/");
      }
      view.unmount();
    }
    await exercise("public");
    await exercise("preview");
  });

  it("fails closed for malformed nodes without breaking sibling content or leaking private URLs", () => {
    const layout = structuredClone(fixtures.find((fixture) => fixture.name === "catalog-headline")!.layout) as VisualLayout;
    const column = layout.rows[0]!.columns[0]!;
    const headline = column.children[0] as WidgetNode;
    column.children = [
      headline,
      { id: "dyn-1", type: "blog", props: { source: "posts", limit: 3 } } as WidgetNode,
      { id: "btn-1", type: "button", props: { label: "Safe", href: "/about" } } as WidgetNode,
    ];
    expect(validateVisualLayout(layout).ok).toBe(true);
    const mixed = render(<PublicPageView page={pageDoc(layout, "Mixed")} />);
    expect(screen.getByText("example")).toBeTruthy();
    expect(within(mixed.container).getByRole("status").textContent).toMatch(/unavailable/i);
    expect(screen.getByRole("link", { name: "Safe" }).getAttribute("href")).toBe("/about");
    expect(mixed.container.innerHTML).not.toContain("/admin/");
    expect(mixed.container.innerHTML).not.toContain("javascript:");
    mixed.unmount();
    const unavailable = pageFromResponse(200, {
      title: "Bad visual",
      site: 11,
      blocks: [{ type: "heading", level: 2, text: "Legacy leftover" }],
      metadata: { visual_layout: { schema_version: 99, rows: [] } },
    });
    const bad = render(<PublicPageView page={unavailable} />);
    expect(within(bad.container).getByRole("status").textContent).toMatch(/unavailable/i);
    expect(screen.queryByText("Legacy leftover")).toBeNull();
    bad.unmount();
    const empty = render(<PublicPageView page={pageDoc({ schema_version: 1, rows: [] }, "Empty")} />);
    expect(within(empty.container).getByRole("status").textContent).toMatch(/no visual content/i);
    empty.unmount();
  });
});
