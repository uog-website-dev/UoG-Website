import {describe,it,expect} from "vitest";
import {validateVisualLayout} from "@uog/types";
import {categories,registry,paletteRegistry,newWidget,newRow,starterLayout,outline,insertWidget,chromeWidgetsIn,LEGACY_CHROME_TYPES} from "./visual-builder-model";

describe("Visual Builder contract helpers",()=>{
  it("keeps all 43 registered widget types valid while offering 40 in the palette",()=>{
    expect(registry).toHaveLength(43);
    // The palette deliberately omits legacy Site chrome while the registry
    // keeps those nodes labelable and renderable for published layouts.
    expect(categories.flatMap(value=>value.types).sort()).toEqual(paletteRegistry.map(value=>value.type).sort());
    for(const definition of registry){
      const row=newRow();row.columns[0]!.children=[newWidget(definition.type,{assetId:"00000000-0000-4000-8000-000000000001",altText:"Campus"})];
      const checked=validateVisualLayout({schema_version:1,rows:[row]});
      expect(checked,definition.type).toMatchObject({ok:true});
    }
  });
  it("provides a valid 60/40 demonstration with selectable nested slider content",()=>{
    const layout=starterLayout();
    expect(validateVisualLayout(layout).ok).toBe(true);
    expect(layout.rows[0]!.ratios).toEqual([60,40]);
    const entries=outline(layout);
    expect(entries.filter(value=>value.kind==="widget").map(value=>value.label)).toContain("Layout Slider");
    expect(entries.some(value=>value.depth===3 && value.label==="Headline")).toBe(true);
    expect(new Set(entries.map(value=>value.id)).size).toBe(entries.length);
  });
  it("rejects stale/illegal insertion contexts and enforces the shared node limit",()=>{
    const layout=starterLayout();
    const slider=outline(layout).find(value=>value.label==="Layout Slider")!;
    expect(()=>insertWidget(layout,{columnId:"missing"},newWidget("headline"))).toThrow();
    expect(()=>insertWidget(layout,{columnId:slider.columnId,widgetId:slider.id,itemId:"missing"},newWidget("headline"))).toThrow();
    const original=JSON.stringify(layout);
    const first=layout.rows[0]!.columns[0]!;
    const next=insertWidget(layout,{columnId:first.id},newWidget("image_slider"));
    expect(JSON.stringify(layout)).toBe(original);
    expect(next.rows[0]!.columns[0]!.children.at(-1)!.type).toBe("image_slider");
    first.children=Array.from({length:50},()=>newWidget("headline"));
    expect(()=>insertWidget(layout,{columnId:first.id},newWidget("headline"))).toThrow();
  });
  it("keeps Site logo, title and menu out of the authoring palette but breadcrumbs in it",()=>{
    const palette=categories.flatMap(value=>value.types);
    for(const type of LEGACY_CHROME_TYPES) expect(palette).not.toContain(type);
    expect(palette).toContain("breadcrumbs");
    expect(palette).toContain("page_title");
    expect(palette).toHaveLength(new Set(palette).size);
  });
  it("renders legacy chrome nodes and reports them for migration without rewriting them",()=>{
    const row=newRow();row.columns[0]!.children=[newWidget("site_logo"),newWidget("site_title"),newWidget("menu")];
    const layout={schema_version:1 as const,rows:[row]};
    expect(validateVisualLayout(layout).ok).toBe(true);
    const original=JSON.stringify(layout);
    expect(chromeWidgetsIn(layout).map(value=>value.type)).toEqual(["site_logo","site_title","menu"]);
    expect(JSON.stringify(layout)).toBe(original);
    expect(chromeWidgetsIn(starterLayout())).toEqual([]);
  });
  it("accepts the explicit chrome-free setting and rejects unknown values",()=>{
    expect(validateVisualLayout({schema_version:1,rows:[],settings:{chrome:"none"}}).ok).toBe(true);
    expect(validateVisualLayout({schema_version:1,rows:[],settings:{chrome:"global"}}).ok).toBe(true);
    expect(validateVisualLayout({schema_version:1,rows:[],settings:{chrome:"hidden"}}).ok).toBe(false);
  });
});
