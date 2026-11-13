"""Generate backend/frontend contract artifacts. CI uses --check for drift."""
import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ID = {"type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"}
TEXT = {"type": "string", "minLength": 1, "maxLength": 400}
LONG = {"type": "string", "minLength": 1, "maxLength": 20000}
HREF = {"type": "string", "maxLength": 2000, "pattern": r"^(?:#[a-z][a-z0-9-]{0,63}|/(?!/)[^\s\\]*|https?://[^/\s\\?#]+[^\s\\]*|mailto:[^\s\\]+)$"}
ASSET = {"type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}


def obj(properties, required=None):
    return {"type": "object", "additionalProperties": False, "properties": properties,
            "required": list(properties) if required is None else required}


def items(properties):
    return {"type": "array", "maxItems": 50, "items": obj({"id": ID, **properties})}


MEDIA = {"asset_id": ASSET, "alt": {"type": "string", "maxLength": 255}, "caption": TEXT}
PROFILES = {
    "heading": obj({"text": TEXT, "level": {"enum": [2, 3, 4]}}),
    "text": obj({"text": LONG}),
    "image": obj(MEDIA, ["asset_id", "alt"]),
    "link": obj({"label": TEXT, "href": HREF}),
    "spacer": obj({"size": {"enum": ["xs", "sm", "md", "lg", "xl"]}}),
    "divider": obj({"label": TEXT}, []),
    "icon": obj({"icon": {"enum": ["school", "book", "calendar", "location", "mail", "phone", "check", "info"]}, "label": TEXT}),
    "card": obj({"title": TEXT, "text": LONG, "label": TEXT, "href": HREF}, ["title", "text"]),
    "media": obj({"title": TEXT, "href": HREF}),
    "quote": obj({"text": LONG, "attribution": TEXT}),
    "list": obj({"items": items({"text": TEXT})}),
    "links": obj({"items": items({"label": TEXT, "href": HREF})}),
    "cards": obj({"items": items({"title": TEXT, "text": LONG})}),
    "questions": obj({"items": items({"title": TEXT, "text": LONG})}),
    "media_items": obj({"items": items(MEDIA)}),
    "stat": obj({"value": {"type": "number", "minimum": 0, "maximum": 1000000000}, "label": TEXT}),
    "progress": obj({"value": {"type": "number", "minimum": 0, "maximum": 100}, "label": TEXT}),
    "table": obj({"columns": {"type": "array", "minItems": 1, "maxItems": 8, "items": TEXT},
                  "items": items({"cells": {"type": "array", "minItems": 1, "maxItems": 8, "items": TEXT}})}),
    "contact": obj({"title": TEXT, "text": LONG, "href": HREF}),
    "feed": obj({"title": TEXT, "limit": {"type": "integer", "minimum": 1, "maximum": 20}}),
}
# Product-provided 43-widget palette (2026-11-12).
PROFILES.update({
 "rich_text": obj({"html":LONG}),
 "hero": obj({"asset_id":ASSET,"alt":{"type":"string","maxLength":255},"title":TEXT,"text":LONG},["asset_id","alt","title"]),
 "source": obj({"source":{"enum":["posts","pages"]},"limit":{"type":"integer","minimum":1,"maximum":20},"category":ID},["source","limit"]),
 "identity": obj({}),
 "menu": obj({"menu_code":ID}),
 "form": obj({"form_code":ID,"submit_label":TEXT}),
 "taxonomy": obj({"taxonomy_code":ID,"limit":{"type":"integer","minimum":1,"maximum":50}}),
 "animation": obj({"animation_code":ID,"loop":{"type":"boolean"}}),
 "video": obj({"provider":{"enum":["youtube","vimeo"]},"video_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"title":TEXT}),
 "map": obj({"latitude":{"type":"number","minimum":-90,"maximum":90},"longitude":{"type":"number","minimum":-180,"maximum":180},"zoom":{"type":"integer","minimum":1,"maximum":20},"title":TEXT}),
 "anchor": obj({"anchor":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"}}),
 "countdown": obj({"ends_at":{"type":"string","pattern":r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"},"label":TEXT}),
 "alert": obj({"text":LONG,"severity":{"enum":["info","warning","success","error"]}}),
 "toc": obj({"title":TEXT,"max_level":{"enum":[2,3,4]}}),
 "price": obj({"title":TEXT,"price":{"type":"string","maxLength":64},"items":items({"text":TEXT}),"label":TEXT,"href":HREF}),
})
PROFILES["hero"]["properties"].update({
 "layout":{"enum":["stacked","split","split_reverse","overlay"]},
 "height":{"enum":["compact","medium","tall","screen"]},
 "mask":{"enum":["none","curve","rounded"]},
 "image_position":{"enum":["center","top","bottom","left","right"]},
 "actions":items({"label":TEXT,"href":HREF}),
})
PROFILES["link"]["properties"].update({"variant":{"enum":["text","solid","outline"]}})
CATALOG = {
 "hero_image":"hero", "image_slider":"media_items", "image_grid":"media_items",
 "layout_slider":"layout_items", "simple_masonry":"layout_items", "anything_carousel":"layout_items",
 "lottie_player":"animation", "video_player":"video", "image":"image",
 "button":"link", "button_grid":"links", "contact_form":"form", "tabs":"questions",
 "accordion":"questions", "call_to_action":"card", "headline":"heading", "editor":"rich_text",
 "blog":"source", "recent_posts":"source", "post_carousel":"source", "testimonials":"quote",
 "author_box":"card", "features":"cards", "taxonomy":"taxonomy", "icon":"icon",
 "price_table":"price", "google_maps":"map", "social_media_buttons":"links",
 "site_logo":"identity", "site_title":"identity", "page_title":"identity", "menu":"menu",
 "breadcrumbs":"identity", "loop_grid":"source", "loop_carousel":"source",
 "taxonomy_filter":"taxonomy", "post_title":"identity", "post_excerpt":"identity",
 "featured_image":"identity", "alert":"alert", "table_of_contents":"toc",
 "menu_anchor":"anchor", "countdown":"countdown",
}
def presentation_schema():
    return obj({"align": {"enum": ["start", "center", "end"]},
                 "tone": {"enum": ["default", "muted", "brand"]},
                 "gap": { "enum": ["none","sm","md","lg"] },
                 "padding":{"enum":["none","sm","md","lg","xl"]},
                 "text_size":{"enum":["sm","md","lg","xl","display"]},
                 "text_color":{"enum":["default","brand","inverse","muted"]},
                 "background":{"enum":["none","paper","mist","navy","blue","gold","blue_gradient","navy_gradient"]},
                 "radius":{"enum":["none","sm","md","lg","pill"]},
                 "border":{"enum":["none","subtle","brand"]},
                 "shadow":{"enum":["none","sm","md","lg"]},
                 "image_fit":{"enum":["natural","cover","contain"]},
                 "image_position":{"enum":["center","top","bottom","left","right"]},
                 "image_height":{"enum":["natural","compact","medium","tall"]}}, [])


# Content slides contain a bounded leaf-only sublayout, never another Section.
PROFILES["layout_items"] = obj({"items":items({"children":{"type":"array","maxItems":20,"items":{"oneOf":[obj({"id":ID,"type":{"const":name},"props":PROFILES[CATALOG[name]],"style":presentation_schema()},["id","type","props"]) for name in ["hero_image","headline","editor","image","button"]]}}})})
RATIOS = [[100], [50, 50], [60, 40], [40, 60], [70, 30], [30, 70], [75, 25], [25, 75], [1, 1, 1]]


def build_schema():
    gap = {"enum": ["none", "sm", "md", "lg"]}
    style = presentation_schema()
    # Desktop is the base surface. Only tablet/mobile may carry explicit overrides;
    # omitting a key inherits the next wider resolved value. Reset removes the key.
    section_override = obj({"stack": {"type": "boolean"}, "gap": gap}, [])
    widget_override = obj({"gap": gap}, [])
    section_responsive = obj({"tablet": section_override, "mobile": section_override}, [])
    widget_responsive = obj({"tablet": widget_override, "mobile": widget_override}, [])
    leaves = [obj({"id": ID, "type": {"const": name}, "props": PROFILES[profile], "style": style,
                   "responsive": widget_responsive},
                  ["id", "type", "props"]) for name, profile in CATALOG.items()]
    column = obj({"id": ID, "type": {"const": "column"},
                  "children": {"type": "array", "maxItems": 50, "items": {"oneOf": leaves}}})
    row = obj({"id": ID, "type": {"const": "section"}, "ratios": {"enum": RATIOS},
               "columns": {"type": "array", "minItems": 1, "maxItems": 3, "items": column},
               "style": style, "responsive": section_responsive},
              ["id", "type", "ratios", "columns"])
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "UoG visual layout v1",
            **obj({"schema_version": {"const": 1}, "rows": {"type": "array", "maxItems": 50, "items": row},
                   "settings":obj({"show_title":{"type":"boolean"},"content_width":{"enum":["full","wide","reading"]}},[])},["schema_version","rows"]),
            "x-limits": {"max_nodes": 200, "max_depth": 4, "max_bytes": 262144},
            "x-breakpoints": {
                "tokens": ["desktop", "tablet", "mobile"],
                "widths": {"desktop": 1280, "tablet": 768, "mobile": 390},
                "ranges": {"mobile": {"max": 767}, "tablet": {"min": 768, "max": 1279}, "desktop": {"min": 1280}},
                "stack_default_min_width": 900,
                "override_tokens": ["tablet", "mobile"],
                "section_properties": ["stack", "gap"],
                "widget_properties": ["gap"],
            },
            "x-registry": [{"type": name, "label": name.replace("_", " ").title(), "profile": profile} for name, profile in CATALOG.items()]}


def fixture():
    return {"schema_version": 1, "rows": [{"id": "section-1", "type": "section", "ratios": [1, 1, 1], "columns": [
        {"id": "column-1", "type": "column", "children": [{"id": "heading-1", "type": "headline", "props": {"text": "Our university", "level": 2}}]},
        {"id": "column-2", "type": "column", "children": [{"id": "slider-1", "type": "image_slider", "props": {"items": [{"id": "slide-1", "asset_id": "00000000-0000-4000-8000-000000000001", "alt": "Campus", "caption": "Campus life"}]}}]},
        {"id": "column-3", "type": "column", "children": [{"id": "text-1", "type": "editor", "props": {"html": "<p>Study and research</p>"}}]},
    ]}]}


def ts_type(schema):
    if "oneOf" in schema: return " | ".join(ts_type(item) for item in schema["oneOf"])
    if "const" in schema: return json.dumps(schema["const"])
    if "enum" in schema: return " | ".join(json.dumps(v) for v in schema["enum"])
    kind=schema.get("type")
    if kind=="object":
        return "{ " + "; ".join(key + ("" if key in schema.get("required",[]) else "?") + ": " + ts_type(value) for key,value in schema["properties"].items()) + " }"
    if kind=="array": return "Array<" + ts_type(schema["items"]) + ">"
    return {"string":"string","integer":"number","number":"number","boolean":"boolean"}[kind]


def types_source():
    lines=["// Generated by scripts/generate_layout_contract.py; do not edit.", "export interface WidgetPropsMap {"]
    lines += ["  " + name + ": " + ts_type(PROFILES[profile]) + ";" for name,profile in CATALOG.items()]
    lines += ["}", "export type WidgetType = keyof WidgetPropsMap;",
      'export type GapToken = "none" | "sm" | "md" | "lg";',
      'export type LayoutBreakpoint = "desktop" | "tablet" | "mobile";',
      'export type LayoutOverrideBreakpoint = "tablet" | "mobile";',
      'export type LayoutStyle = ' + ts_type(build_schema()["properties"]["rows"]["items"]["properties"]["style"]) + ';',
      'export interface SectionResponsiveOverride { stack?: boolean; gap?: GapToken }',
      'export interface WidgetResponsiveOverride { gap?: GapToken }',
      'export type SectionResponsive = Partial<Record<LayoutOverrideBreakpoint, SectionResponsiveOverride>>;',
      'export type WidgetResponsive = Partial<Record<LayoutOverrideBreakpoint, WidgetResponsiveOverride>>;',
      'export type WidgetNode = { [K in WidgetType]: { id: string; type: K; props: WidgetPropsMap[K]; style?: LayoutStyle; responsive?: WidgetResponsive } }[WidgetType];',
      'export interface LayoutColumn { id: string; type: "column"; children: WidgetNode[] }',
      'export type ColumnRatios = ' + ' | '.join(str(r) for r in RATIOS) + ';',
      'export interface LayoutSection { id: string; type: "section"; ratios: ColumnRatios; columns: LayoutColumn[]; style?: LayoutStyle; responsive?: SectionResponsive }',
      'export interface VisualLayout { schema_version: 1; rows: LayoutSection[]; settings?: ' + ts_type(build_schema()["properties"]["settings"]) + ' }']
    return "\n".join(lines)+"\n"


def example(schema):
    if "const" in schema: return schema["const"]
    if "enum" in schema: return schema["enum"][0]
    if "oneOf" in schema: return example(schema["oneOf"][0])
    kind=schema.get("type")
    if kind=="object": return {key:example(value) for key,value in schema["properties"].items() if key in schema["required"]}
    if kind=="array": return [example(schema["items"]) for _ in range(max(1,schema.get("minItems",1)))]
    if kind in ("integer","number"): return schema.get("minimum",1)
    if kind=="boolean": return False
    if schema == ID: return "item-example"
    if schema == ASSET: return MEDIA_SAMPLE["asset_id"]
    if schema == HREF: return "/about"
    if "pattern" in schema and "T" in schema["pattern"]: return "2030-01-01T00:00:00Z"
    return "example"


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true"); args = parser.parse_args()
    valid = fixture(); cases = [{"name": "three-column-slider", "valid": True, "layout": valid}]
    for name, change in [("unknown-widget", lambda d: d["rows"][0]["columns"][0]["children"][0].update(type="unknown")),
                         ("duplicate-id", lambda d: d["rows"][0]["columns"][1].update(id="column-1")),
                         ("nested-section", lambda d: d["rows"][0]["columns"][0]["children"].append(copy.deepcopy(d["rows"][0]))),
                         ("excessive-items", lambda d: d["rows"][0]["columns"][1]["children"][0]["props"].update(items=[{"id": f"slide-{i}", **MEDIA_SAMPLE} for i in range(51)])),
                         ("unsupported-version", lambda d: d.update(schema_version=99)),
                         ("ratio-column-mismatch", lambda d: d["rows"][0].update(ratios=[60, 40])),
                         ("unsafe-link", lambda d: d["rows"][0]["columns"][0]["children"].append({"id":"bad-link","type":"button","props":{"label":"Bad","href":"javascript:alert(1)"}})),
                         ("unsafe-style", lambda d: d["rows"][0].update(style={"background":"url(evil)"})),
                         ("unknown-breakpoint", lambda d: d["rows"][0].update(responsive={"desktop":{"gap":"sm"}})),
                         ("unknown-responsive-property", lambda d: d["rows"][0].update(responsive={"mobile":{"padding":"lg"}})),
                         ("widget-stack-forbidden", lambda d: d["rows"][0]["columns"][0]["children"][0].update(responsive={"mobile":{"stack":True}}))]:
        sample = copy.deepcopy(valid); change(sample); cases.append({"name": name, "valid": False, "layout": sample})
    # Valid mobile spacing override on a section; tablet stacking override on multi-column row.
    spaced = copy.deepcopy(valid)
    spaced["rows"][0]["style"] = {"gap": "md"}
    spaced["rows"][0]["responsive"] = {"mobile": {"gap": "lg"}, "tablet": {"stack": True}}
    spaced["rows"][0]["columns"][0]["children"][0]["style"] = {"gap": "sm"}
    spaced["rows"][0]["columns"][0]["children"][0]["responsive"] = {"mobile": {"gap": "none"}}
    cases.append({"name": "responsive-spacing-stack", "valid": True, "layout": spaced})
    for widget_type, profile in CATALOG.items():
        doc={"schema_version":1,"rows":[{"id":"row-1","type":"section","ratios":[100],"columns":[{"id":"column-1","type":"column","children":[{"id":"widget-1","type":widget_type,"props":example(PROFILES[profile])}]}]}]}
        cases.append({"name":"catalog-"+widget_type,"valid":True,"layout":doc})
    for filename, value in [("layout-v1.schema.json", build_schema()), ("fixtures.json", cases)]:
        content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        for folder in ["backend/apps/cms/schemas/layout", "frontend/packages/types/src/layout"]:
            path = ROOT / folder / filename
            if args.check:
                if not path.exists() or path.read_text(encoding="utf-8") != content: raise SystemExit(f"Contract artifact drift: {path}")
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

    if args.check:
        frozen = ROOT / "backend/apps/cms/migrations/layout_v1_schema.json"
        if json.loads(frozen.read_text(encoding="utf-8")) != build_schema(): raise SystemExit("Frozen migration schema drift")
    types_path=ROOT / "frontend/packages/types/src/layout/generated.ts"
    content=types_source()
    if args.check:
        if types_path.read_text(encoding="utf-8") != content: raise SystemExit("Generated layout types drift")
    else: types_path.write_text(content,encoding="utf-8")


MEDIA_SAMPLE = {"asset_id": "00000000-0000-4000-8000-000000000001", "alt": "Campus", "caption": "Campus life"}
if __name__ == "__main__": main()
