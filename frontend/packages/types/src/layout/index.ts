import schemaData from "./layout-v1.schema.json";
import type { VisualLayout } from "./generated";
export type {
  VisualLayout, WidgetNode, WidgetType, WidgetPropsMap, LayoutSection, LayoutColumn, LayoutStyle,
  GapToken, LayoutBreakpoint, LayoutOverrideBreakpoint, SectionResponsive, SectionResponsiveOverride,
  WidgetResponsive, WidgetResponsiveOverride,
} from "./generated";
export {
  LAYOUT_BREAKPOINT_WIDTHS, LAYOUT_BREAKPOINT_RANGES, LAYOUT_STACK_DEFAULT_MIN_WIDTH,
  LAYOUT_OVERRIDE_BREAKPOINTS, breakpointAtWidth, resolveSectionPresentation, resolveWidgetPresentation,
  resetResponsiveProperty, setResponsiveProperty, precedenceMatrix,
} from "./responsive";
export type { ResolvedSectionPresentation, ResolvedWidgetPresentation } from "./responsive";

type Schema = { type?: string; const?: unknown; enum?: unknown[]; oneOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number };
export const layoutSchema = schemaData;
export const widgetRegistry = schemaData["x-registry"];
/** Sidebar adapters reuse approved Menu, Loop Grid and Recent Posts sources. */
export const sidebarWidgetRegistry = [
  { type: "menu", registryType: "menu", label: widgetRegistry.find(row => row.type === "menu")!.label },
  { type: "related_pages", registryType: "loop_grid", label: "Related Pages" },
  { type: "recent_posts", registryType: "recent_posts", label: widgetRegistry.find(row => row.type === "recent_posts")!.label },
] as const;
export type LayoutValidation = { ok: true; value: VisualLayout } | { ok: false; errors: Record<string, string[]> };
export interface VisualDraftErrorLocation {
  path: string;
  node_id: string | null;
  item_id: string | null;
  item_index: number | null;
  messages: string[];
}
export interface VisualDraftValidationDetails {
  fields: Record<string, string[]>;
  nodes: VisualDraftErrorLocation[];
}

/** Both frontends use the same generated JSON schema as the backend. */
export function validateVisualLayout(value: unknown): LayoutValidation {
  const errors: Record<string, string[]> = {};
  const reject = (path: string, message: string) => { (errors[path] ??= []).push(message); };
  try {
    const json = JSON.stringify(value);
    if (!json || new TextEncoder().encode(json).length > schemaData["x-limits"].max_bytes) return {ok:false, errors:{visual_layout:["Layout exceeds its JSON byte limit."]}};
  } catch { return {ok:false, errors:{visual_layout:["Use a bounded JSON document."]}}; }
  function check(data: unknown, schema: Schema, path: string): void {
    const object = data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
    if (schema.oneOf) {
      const candidate = schema.oneOf.find(item => object && item.properties?.type?.const === object.type);
      if (!candidate) reject(`${path}.type`, "Unknown widget or nested Section. Use a registered leaf widget.");
      else check(data, candidate, path);
      return;
    }
    if ("const" in schema && data !== schema.const) reject(path, "Unsupported value or schema version.");
    if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(data))) reject(path, "Use an approved token or column ratio.");
    const valid: Record<string, boolean> = {object:!!object, array:Array.isArray(data), string:typeof data === "string", boolean:typeof data === "boolean", integer:typeof data === "number" && Number.isInteger(data), number:typeof data === "number" && Number.isFinite(data)};
    if (schema.type && !valid[schema.type]) {reject(path, `Expected ${schema.type}.`); return;}
    if (schema.type === "object" && object) {
      for (const key of schema.required ?? []) if (!Object.hasOwn(object,key)) reject(`${path}.${key}`,"This field is required.");
      for (const [key, child] of Object.entries(object)) {
        if (!Object.hasOwn(schema.properties ?? {},key)) reject(`${path}.${key}`,"Unsupported field.");
        else check(child,schema.properties![key]!,`${path}.${key}`);
      }
    } else if (schema.type === "array" && Array.isArray(data)) {
      if(data.length < (schema.minItems ?? 0) || data.length > (schema.maxItems ?? 200)) {reject(path,"Item count exceeds the allowed bounds.");return;}
      data.forEach((child,index)=>check(child,schema.items!,`${path}[${index}]`));
    } else if (schema.type === "string" && typeof data === "string") {
      const length = [...data].length;
      if(length < (schema.minLength ?? 0) || length > (schema.maxLength ?? 20000)) reject(path,"Text length exceeds the allowed bounds.");
      if(schema.pattern) {const match = new RegExp(schema.pattern,"u").exec(data);if(!match || match[0] !== data) reject(path,"Invalid identifier, date or safe link.");}
      if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(data)) reject(path,"Control characters are not allowed.");
    } else if((schema.type === "number" || schema.type === "integer") && typeof data === "number") {
      if(data < (schema.minimum ?? -Infinity) || data > (schema.maximum ?? Infinity)) reject(path,"Number exceeds the allowed bounds.");
    }
  }
  check(value,schemaData as unknown as Schema,"metadata.visual_layout");
  if(Object.keys(errors).length) return {ok:false,errors};
  const layout = value as VisualLayout;
  let count=0; const seen=new Set<string>();
  layout.rows.forEach((row,i)=>{
    const path=`metadata.visual_layout.rows[${i}]`;
    if(row.ratios.length !== row.columns.length) reject(`${path}.ratios`,"Ratios must match the ordered column count.");
    const nodes=[{node:row,path},...row.columns.flatMap((column,j)=>[{node:column,path:`${path}.columns[${j}]`},...column.children.map((node,k)=>({node,path:`${path}.columns[${j}].children[${k}]`}))])];
    const visit = ({node,path:nodePath}: {node:{id:string;props?:unknown};path:string}):void=>{
      count++; if(seen.has(node.id)) reject(`${nodePath}.id`,"Node IDs must be unique across the document.");seen.add(node.id);
      const props=node.props as {actions?:Array<{id:string}>;items?:Array<{id:string;children?:Array<{id:string;props?:unknown}>}>}|undefined;
      if(props?.actions){const ids=new Set<string>();props.actions.forEach((action,index)=>{if(ids.has(action.id))reject(`${nodePath}.props.actions[${index}].id`,"Action IDs must be unique within a widget.");ids.add(action.id);});}
      if(props?.items){const items=new Set<string>();props.items.forEach((item,index)=>{if(items.has(item.id))reject(`${nodePath}.props.items[${index}].id`,"Repeated item IDs must be unique within a widget.");items.add(item.id);item.children?.forEach((child,j)=>visit({node:child,path:`${nodePath}.props.items[${index}].children[${j}]`}));});}
    };
    nodes.forEach(visit);
  });
  if(count > schemaData["x-limits"].max_nodes) reject("metadata.visual_layout.rows","Layout exceeds 200 nodes.");
  return Object.keys(errors).length ? {ok:false,errors} : {ok:true,value:structuredClone(layout)};
}

export { adaptLegacyBlocks } from "./legacy";
