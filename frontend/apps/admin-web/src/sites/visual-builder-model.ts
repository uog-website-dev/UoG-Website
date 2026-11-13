import { layoutSchema, widgetRegistry, validateVisualLayout } from "@uog/types";
import type { VisualLayout, WidgetNode, WidgetType, LayoutSection, LayoutColumn } from "@uog/types";

export interface PropertySchema {
  type?: string; const?: unknown; enum?: unknown[]; properties?: Record<string, PropertySchema>;
  required?: string[]; items?: PropertySchema; oneOf?: PropertySchema[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; pattern?: string;
}
const leaves = (layoutSchema.properties.rows.items.properties.columns.items.properties.children.items.oneOf as unknown) as PropertySchema[];
export const registry = widgetRegistry.map(entry => ({...entry, type:entry.type as WidgetType}));
export const categories: {label:string; shortLabel:string; types:WidgetType[]}[] = [
  {label:"Media & sliders",shortLabel:"MEDIA",types:["hero_image","image_slider","image_grid","layout_slider","simple_masonry","anything_carousel","lottie_player","video_player","image"]},
  {label:"Interactive",shortLabel:"INTERACTIVE",types:["button","button_grid","contact_form","tabs","accordion","call_to_action"]},
  {label:"Content",shortLabel:"CONTENT",types:["headline","editor","blog","recent_posts","post_carousel","testimonials","author_box","features"]},
  {label:"Information",shortLabel:"INFORMATION",types:["taxonomy","icon","price_table","google_maps","social_media_buttons"]},
  {label:"Site & navigation",shortLabel:"SITE",types:["site_logo","site_title","page_title","menu","breadcrumbs"]},
  {label:"Dynamic content",shortLabel:"DYNAMIC",types:["loop_grid","loop_carousel","taxonomy_filter","post_title","post_excerpt","featured_image"]},
  {label:"Page utilities",shortLabel:"PAGE",types:["alert","table_of_contents","menu_anchor","countdown"]},
];
export const uid = () => crypto.randomUUID();
export const labelFor = (type:string) => registry.find(entry=>entry.type===type)?.label ?? type;
export const schemaFor = (type:WidgetType) => leaves.find(schema=>schema.properties?.type?.const===type)!.properties!.props!;
export const presentationSchema = layoutSchema.properties.rows.items.properties.style as PropertySchema;
export const emptyLayout = ():VisualLayout => ({schema_version:1,rows:[]});

/** Matches the layout contract safe-link pattern (site path, http(s), mailto). */
export const SAFE_LINK_PATTERN = /^(?:#[a-z][a-z0-9-]{0,63}|\/(?!\/)[^\s\\]*|https?:\/\/[^/\s\\?#]+[^\s\\]*|mailto:[^\s\\]+)$/u;
export const SAFE_LINK_MESSAGE = "Use a site path (/about), http(s) URL or mailto link. javascript: and other unsafe destinations are not allowed.";
export function isSafeLink(value: string): boolean {
  return SAFE_LINK_PATTERN.test(value);
}
export function fieldMessages(errors: Record<string, string[]>, path: string): string[] {
  return errors[path] ?? [];
}
export function newRow():LayoutSection {
  return {id:uid(),type:"section",ratios:[100],columns:[{id:uid(),type:"column",children:[]}]};
}
/** Required values come from the contract; media identity is supplied by the scoped picker. */
export function initialValue(schema:PropertySchema, key=""):unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type==="object") return Object.fromEntries((schema.required??[]).map(name=>[name,initialValue(schema.properties![name]!,name)]));
  if (schema.type==="array") return [];
  if (schema.type==="boolean") return false;
  if (schema.type==="integer" || schema.type==="number") return Math.max(0,schema.minimum??0);
  if (key==="id") return uid();
  if (key==="asset_id") return "";
  if (key==="taxonomy_code") return "categories";
  if (key==="menu_code") return "header";
  if (key==="href") return "/";
  if (key==="ends_at") return "2030-01-01T00:00:00Z";
  if (key==="html") return "<p>Add your content here.</p>";
  if (key==="alt" || key==="caption") return "";
  if (schema.pattern) return "example";
  return key==="text" ? "Add your content here" : key.replaceAll("_"," ");
}
export function newWidget(type:WidgetType, asset?:{assetId:string;altText:string}):WidgetNode {
  const props=initialValue(schemaFor(type)) as Record<string,unknown>;
  if(type==="hero_image")Object.assign(props,{layout:"split",height:"medium",mask:"none"});
  if (asset && (type==="image" || type==="hero_image")) {props.asset_id=asset.assetId;props.alt=[...asset.altText].slice(0,255).join("");}
  if (["layout_slider","anything_carousel","simple_masonry"].includes(type)) {
    props.items=[{id:uid(),children:[{id:uid(),type:"headline",props:{text:"Slide headline",level:2}}]}];
  }
  return {id:uid(),type,props} as WidgetNode;
}
export function nestedItems(widget:WidgetNode):{id:string;children:WidgetNode[]}[] {
  return widget.type==="layout_slider" || widget.type==="anything_carousel" || widget.type==="simple_masonry" ? widget.props.items : [];
}
/** Resolve the props JSON path for a selected widget so inspector fields can map client/server errors. */
export function widgetPropsPath(layout: VisualLayout, widgetId: string): string | null {
  for (let i = 0; i < layout.rows.length; i++) {
    const row = layout.rows[i]!;
    for (let j = 0; j < row.columns.length; j++) {
      const column = row.columns[j]!;
      for (let k = 0; k < column.children.length; k++) {
        const widget = column.children[k]!;
        const base = `metadata.visual_layout.rows[${i}].columns[${j}].children[${k}]`;
        if (widget.id === widgetId) return `${base}.props`;
        for (let itemIndex = 0; itemIndex < nestedItems(widget).length; itemIndex++) {
          const item = nestedItems(widget)[itemIndex]!;
          for (let childIndex = 0; childIndex < item.children.length; childIndex++) {
            if (item.children[childIndex]!.id === widgetId) {
              return `${base}.props.items[${itemIndex}].children[${childIndex}].props`;
            }
          }
        }
      }
    }
  }
  return null;
}
export interface TreeEntry {id:string;kind:"row"|"column"|"widget";label:string;depth:number;node:LayoutSection|LayoutColumn|WidgetNode;columnId:string;itemId?:string}
export function outline(layout:VisualLayout):TreeEntry[] {
  const entries:TreeEntry[]=[];
  const visit=(node:WidgetNode,depth:number,columnId:string,itemId?:string) => {
    entries.push({id:node.id,kind:"widget",label:labelFor(node.type),node,depth,columnId,itemId});
    nestedItems(node).forEach(item=>item.children.forEach(child=>visit(child,depth+1,columnId,item.id)));
  };
  layout.rows.forEach((row,i)=>{
    entries.push({id:row.id,kind:"row",label:`Row ${i+1}`,depth:0,node:row,columnId:row.columns[0]!.id});
    row.columns.forEach((column,j)=>{
      entries.push({id:column.id,kind:"column",label:`Column ${j+1}`,depth:1,node:column,columnId:column.id});
      column.children.forEach(widget=>visit(widget,2,column.id));
    });
  });
  return entries;
}
export interface InsertionContext {columnId:string; widgetId?:string; itemId?:string; index?:number}
export function insertWidget(layout:VisualLayout,context:InsertionContext,widget:WidgetNode):VisualLayout {
  const next=structuredClone(layout);
  if(context.widgetId){
    const parent=outline(next).find(entry=>entry.id===context.widgetId)?.node as WidgetNode|undefined;
    const item=parent && nestedItems(parent).find(value=>value.id===context.itemId);
    if(!item || !["hero_image","headline","editor","image","button"].includes(widget.type)) throw new Error("This insertion context is no longer available.");
    item.children.push(widget as typeof item.children[number]);
  } else {
    const column=next.rows.flatMap(row=>row.columns).find(value=>value.id===context.columnId);
    if(!column) throw new Error("This column is no longer available.");
    const index = typeof context.index === "number" ? context.index : column.children.length;
    column.children.splice(Math.max(0, Math.min(index, column.children.length)), 0, widget);
  }
  const checked=validateVisualLayout(next);
  if(!checked.ok) throw new Error(Object.values(checked.errors).flat()[0]??"The layout limit was reached.");
  return checked.value;
}

export type CompositionResult =
  | { ok: true; layout: VisualLayout; focusId: string | null; announcement: string }
  | { ok: false; layout: VisualLayout; announcement: string };

function commit(layout: VisualLayout, focusId: string | null, announcement: string): CompositionResult {
  const checked = validateVisualLayout(layout);
  if (!checked.ok) {
    return {
      ok: false,
      layout,
      announcement: Object.values(checked.errors).flat()[0] ?? "That change is not allowed.",
    };
  }
  return { ok: true, layout: checked.value, focusId, announcement };
}

export function orderedIds(layout: VisualLayout): string[] {
  return outline(layout).map((entry) => entry.id);
}

function findColumn(layout: VisualLayout, columnId: string): LayoutColumn | undefined {
  return layout.rows.flatMap((row) => row.columns).find((column) => column.id === columnId);
}

function locateWidget(layout: VisualLayout, widgetId: string): { column: LayoutColumn; index: number; parent?: WidgetNode; itemId?: string } | null {
  for (const row of layout.rows) {
    for (const column of row.columns) {
      const index = column.children.findIndex((widget) => widget.id === widgetId);
      if (index >= 0) return { column, index };
      for (const widget of column.children) {
        for (const item of nestedItems(widget)) {
          const nested = item.children.findIndex((child) => child.id === widgetId);
          if (nested >= 0) return { column, index: nested, parent: widget, itemId: item.id };
        }
      }
    }
  }
  return null;
}

/** Shared row reorder used by pointer drop and keyboard ↑/↓. */
export function moveRow(layout: VisualLayout, rowId: string, direction: -1 | 1): CompositionResult {
  const next = structuredClone(layout);
  const index = next.rows.findIndex((row) => row.id === rowId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.rows.length) {
    return { ok: false, layout, announcement: "That row cannot move further." };
  }
  const [row] = next.rows.splice(index, 1);
  next.rows.splice(target, 0, row!);
  return commit(next, rowId, `Moved row to position ${target + 1}.`);
}

export function reorderRowsByIds(layout: VisualLayout, order: string[]): CompositionResult {
  const next = structuredClone(layout);
  if (order.length !== next.rows.length || new Set(order).size !== order.length) {
    return { ok: false, layout, announcement: "Invalid row drop target." };
  }
  const byId = new Map(next.rows.map((row) => [row.id, row]));
  if (!order.every((id) => byId.has(id))) {
    return { ok: false, layout, announcement: "Invalid row drop target." };
  }
  next.rows = order.map((id) => byId.get(id)!);
  return commit(next, order[0] ?? null, "Rows reordered.");
}

/**
 * Move a top-level widget into a column at index. Rejects nested-section drops
 * and unknown targets without mutating the caller layout.
 */
export function moveWidget(
  layout: VisualLayout,
  widgetId: string,
  target: { columnId: string; index: number },
): CompositionResult {
  const next = structuredClone(layout);
  const source = locateWidget(next, widgetId);
  const column = findColumn(next, target.columnId);
  if (!source || !column || source.parent) {
    return { ok: false, layout, announcement: "That drop target is not available." };
  }
  if (column.children.some((child) => child.type === "section" as never)) {
    return { ok: false, layout, announcement: "Sections cannot be nested." };
  }
  const [widget] = source.column.children.splice(source.index, 1);
  if (!widget) return { ok: false, layout, announcement: "That widget is no longer available." };
  let index = target.index;
  if (source.column.id === column.id && source.index < target.index) index -= 1;
  index = Math.max(0, Math.min(index, column.children.length));
  column.children.splice(index, 0, widget);
  return commit(next, widgetId, "Widget moved.");
}

export function shiftWidget(layout: VisualLayout, widgetId: string, direction: -1 | 1): CompositionResult {
  const next = structuredClone(layout);
  const source = locateWidget(next, widgetId);
  if (!source || source.parent) {
    return { ok: false, layout, announcement: "That widget cannot move here." };
  }
  const target = source.index + direction;
  if (target < 0 || target >= source.column.children.length) {
    return { ok: false, layout, announcement: "That widget cannot move further." };
  }
  const [widget] = source.column.children.splice(source.index, 1);
  source.column.children.splice(target, 0, widget!);
  return commit(next, widgetId, "Widget moved.");
}

export function removeNode(layout: VisualLayout, nodeId: string): CompositionResult {
  const next = structuredClone(layout);
  const entries = outline(next);
  const entry = entries.find((value) => value.id === nodeId);
  if (!entry || entry.kind === "column") {
    return { ok: false, layout, announcement: "That component cannot be removed." };
  }
  const siblings = entries.filter((value) => {
    if (entry.kind === "row") return value.kind === "row";
    return value.kind === "widget" && value.columnId === entry.columnId && value.depth === entry.depth && value.itemId === entry.itemId;
  });
  const index = siblings.findIndex((value) => value.id === nodeId);
  const focusId = siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? (entry.kind === "widget" ? entry.columnId : null);

  if (entry.kind === "row") {
    next.rows = next.rows.filter((row) => row.id !== nodeId);
  } else {
    for (const row of next.rows) {
      for (const column of row.columns) {
        column.children = column.children.filter((widget) => widget.id !== nodeId);
        for (const widget of column.children) {
          for (const item of nestedItems(widget)) {
            item.children = item.children.filter((child) => child.id !== nodeId);
          }
        }
      }
    }
  }
  return commit(next, focusId, `Removed ${entry.label}.`);
}

function remapIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => remapIds(entry)) as T;
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    next[key] = key === "id" && typeof entry === "string" ? uid() : remapIds(entry);
  }
  return next as T;
}

/** Duplicate a section with fresh IDs for the section, columns, widgets and repeater items. */
export function duplicateSection(layout: VisualLayout, rowId: string): CompositionResult {
  const next = structuredClone(layout);
  const index = next.rows.findIndex((row) => row.id === rowId);
  if (index < 0) return { ok: false, layout, announcement: "That section is no longer available." };
  if (next.rows.length >= 50) return { ok: false, layout, announcement: "A layout can contain at most 50 rows." };
  const clone = remapIds(structuredClone(next.rows[index]!));
  next.rows.splice(index + 1, 0, clone);
  return commit(next, clone.id, "Section duplicated with new component IDs.");
}

/** Duplicate a top-level column widget with fresh descendant IDs. */
export function duplicateWidget(layout: VisualLayout, widgetId: string): CompositionResult {
  const next = structuredClone(layout);
  const source = locateWidget(next, widgetId);
  if (!source || source.parent) {
    return { ok: false, layout, announcement: "That widget cannot be duplicated here." };
  }
  const clone = remapIds(structuredClone(source.column.children[source.index]!));
  source.column.children.splice(source.index + 1, 0, clone);
  return commit(next, clone.id, `${labelFor(clone.type)} duplicated with new component IDs.`);
}

export function resizeColumns(
  layout: VisualLayout,
  rowId: string,
  ratios: LayoutSection["ratios"],
): CompositionResult {
  const next = structuredClone(layout);
  const section = next.rows.find((row) => row.id === rowId);
  if (!section) return { ok: false, layout, announcement: "That section is no longer available." };
  if (ratios.length < section.columns.length) {
    const occupied = section.columns
      .slice(ratios.length)
      .filter((column) => column.children.length > 0)
      .map((column, offset) => ({
        id: column.id,
        label: `Column ${ratios.length + offset + 1}`,
        count: column.children.length,
      }));
    if (occupied.length) {
      return {
        ok: false,
        layout,
        announcement: `Clear ${occupied.map((column) => `${column.label} (${column.count})`).join(", ")} before reducing columns.`,
      };
    }
    section.columns = section.columns.slice(0, ratios.length);
  }
  while (section.columns.length < ratios.length) {
    section.columns.push({ id: uid(), type: "column", children: [] });
  }
  section.ratios = ratios;
  return commit(next, rowId, `Updated to ${ratios.length} column${ratios.length === 1 ? "" : "s"}.`);
}

export function starterLayout():VisualLayout {
  const first=newRow();
  first.ratios=[60,40];first.columns.push({id:uid(),type:"column",children:[]});
  first.columns[0]!.children=[{id:uid(),type:"headline",props:{text:"Welcome to your Site",level:2}},
    {id:uid(),type:"editor",props:{html:"<p>Tell your community what makes this place special.</p>"}}];
  first.columns[1]!.children=[{id:uid(),type:"button",props:{label:"Explore our Site",href:"/about"}}];
  const second=newRow();second.columns[0]!.children=[newWidget("layout_slider")];
  return {schema_version:1,rows:[first,second]};
}
