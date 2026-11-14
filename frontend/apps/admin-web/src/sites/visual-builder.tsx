"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddRounded from "@mui/icons-material/AddRounded";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import DragIndicator from "@mui/icons-material/DragIndicator";
import Fullscreen from "@mui/icons-material/Fullscreen";
import FullscreenExit from "@mui/icons-material/FullscreenExit";
import RedoOutlined from "@mui/icons-material/RedoOutlined";
import SaveOutlined from "@mui/icons-material/SaveOutlined";
import UndoOutlined from "@mui/icons-material/UndoOutlined";
import WidgetsOutlined from "@mui/icons-material/WidgetsOutlined";
import {
  adaptLegacyBlocks,
  LAYOUT_OVERRIDE_BREAKPOINTS,
  resetResponsiveProperty,
  setResponsiveProperty,
  validateVisualLayout,
} from "@uog/types";
import type {
  GapToken,
  LayoutColumn,
  LayoutOverrideBreakpoint,
  LayoutSection,
  LayoutStyle,
  SectionResponsive,
  VisualLayout,
  WidgetNode,
  WidgetResponsive,
  WidgetType,
} from "@uog/types";
import { PublicPageView, pageFromResponse } from "@uog/ui";
import {
  getSiteVisualDraft, saveSiteVisualDraft, openWorkingDraft,
  getSitePagePreview, transitionSitePage,
  listSiteSectionTemplates, createSiteSectionTemplate, insertSiteSectionTemplate,
} from "@/app/sites/page-actions";
import type { SitePagePreview, SitePageRecord, SiteSectionTemplate } from "@/app/sites/page-actions";
import { unwrap } from "@/organizations/contract";
import { APP_BASE_PATH } from "@/base-path";
import { MediaPickerDialog } from "@/sites/media-picker";
import type { MediaPickerResult } from "@/sites/media-picker";
import { ContentWorkflowButtons, ContentWorkflowDialog } from "@/sites/content-workflow";
import type { WorkflowAction } from "@/sites/content-workflow";
import {
  categories, duplicateSection, duplicateWidget, emptyLayout, insertWidget, labelFor,
  moveRow, moveWidget, nestedItems, newRow, newWidget, outline, registry,
  removeNode, reorderRowsByIds, resizeColumns, schemaFor, shiftWidget, starterLayout,
  widgetPropsPath, presentationSchema,
} from "./visual-builder-model";
import type { InsertionContext, TreeEntry } from "./visual-builder-model";
import { InspectorFields } from "./visual-builder-inspector";
import { WidgetIcon } from "./visual-builder-icons";
import { PREVIEW_VIEWPORTS, usePreviewScale, type PreviewViewport } from "./visual-builder-preview";
import {
  historyShortcut,
  pushHistory,
  VISUAL_HISTORY_COALESCE_MS,
  type VisualHistoryEntry,
} from "./visual-builder-history";
import {
  allowVisualDrop,
  beginVisualDrag,
  isPalettePayload,
  paletteTypeFromPayload,
  readVisualDrag,
  type VisualDragPayload,
} from "./visual-builder-dnd";

export interface VisualBuilderProps {
  siteId:number;siteName:string;pageId:string;builderEnabled:boolean|null;permissions:readonly string[];
}
const ratios:LayoutSection["ratios"][]=[[100],[50,50],[60,40],[40,60],[70,30],[30,70],[75,25],[25,75],[1,1,1]];
const human=(key:string)=>key.replaceAll("_"," ").replace(/^./,value=>value.toUpperCase());

/** A keyed workspace drops all old Page/Site state before rendering the next context. */
export function VisualBuilder(props:VisualBuilderProps) {
  if(props.builderEnabled===null) return <Alert severity="info" role="status">Loading Visual Builder module availability…</Alert>;
  if(!props.builderEnabled) return <Alert severity="warning">Visual Builder is disabled. Enable the VISUAL_BUILDER module for this Site to continue.</Alert>;
  if(!props.permissions.includes("content.pages.update")) return <Alert severity="warning">You do not have access to edit visual Pages in this Site.</Alert>;
  if(!Number.isSafeInteger(props.siteId) || props.siteId<1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(props.pageId)) return <Alert severity="error">This Page route is invalid.</Alert>;
  return <BuilderWorkspace key={`${props.siteId}:${props.pageId}`} {...props}/>;
}

function BuilderWorkspace({siteId,siteName,pageId,permissions}:VisualBuilderProps) {
  const router=useRouter();
  const [page,setPage]=useState<SitePageRecord|null>(null);
  const [layout,setLayout]=useState<VisualLayout>(emptyLayout);
  const [selected,setSelected]=useState<string|null>(null);
  const [announcement,setAnnouncement]=useState("");
  const dragId=useRef<VisualDragPayload|null>(null);
  const suppressPaletteClick=useRef(false);
  const [dropHoverColumn,setDropHoverColumn]=useState<string|null>(null);
  function startDrag(event: { dataTransfer: DataTransfer | null; stopPropagation: () => void }, payload: VisualDragPayload) {
    dragId.current = payload;
    beginVisualDrag(event, payload);
  }
  function finishDrag() {
    dragId.current = null;
    setDropHoverColumn(null);
  }
  function dropPayload(event: { dataTransfer: DataTransfer | null }): VisualDragPayload | null {
    const payload = readVisualDrag(event, dragId.current);
    finishDrag();
    return payload;
  }
  function dropWidget(source: VisualDragPayload | null, columnId: string, index: number) {
    if (isPalettePayload(source)) {
      const type = paletteTypeFromPayload(source);
      if (!type || !registry.some(entry => entry.type === type)) {
        setError("That widget is not available in the palette.");
        return;
      }
      insertFromPalette(type as WidgetType, { columnId, index });
      return;
    }
    if (!source?.startsWith("widget:")) {
      if (source?.startsWith("row:")) applyComposition({ ok: false, layout, announcement: "Sections cannot be nested." });
      return;
    }
    applyComposition(moveWidget(layout, source.slice(7), { columnId, index }));
  }
  function resolveCanvasDropContext(clientX: number, clientY: number): InsertionContext | null {
    const hit = typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(clientX, clientY)
      : null;
    if (!hit || !canvasRef.current?.contains(hit)) return defaultInsertContext();
    const node = (hit as Element).closest?.("[data-node-id]") as HTMLElement | null;
    const id = node?.dataset?.nodeId;
    if (!id) return defaultInsertContext();
    const target = outline(layout).find(entry => entry.id === id);
    if (!target) return defaultInsertContext();
    if (target.kind === "column") return { columnId: target.id };
    if (target.kind === "row") return { columnId: target.columnId };
    if (target.kind === "widget" && !target.itemId) {
      const column = layout.rows.flatMap(row => row.columns).find(col => col.id === target.columnId);
      const index = column?.children.findIndex(child => child.id === target.id) ?? -1;
      if (!column || index < 0) return { columnId: target.columnId };
      const rect = node!.getBoundingClientRect();
      const after = clientY > rect.top + rect.height / 2;
      return { columnId: target.columnId, index: after ? index + 1 : index };
    }
    return { columnId: target.columnId };
  }
  function acceptCanvasDrag(event: { preventDefault: () => void; stopPropagation: () => void; dataTransfer: DataTransfer | null; clientX?: number; clientY?: number }) {
    const active = dragId.current;
    if (!active || active.startsWith("row:")) return false;
    allowVisualDrop(event, active);
    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
      const context = resolveCanvasDropContext(event.clientX, event.clientY);
      setDropHoverColumn(context?.columnId ?? null);
    }
    return true;
  }
  function handleCanvasDrop(event: { preventDefault: () => void; stopPropagation: () => void; dataTransfer: DataTransfer | null; clientX: number; clientY: number }) {
    if (!acceptCanvasDrag(event)) return;
    const source = dropPayload(event);
    setDropHoverColumn(null);
    if (!source || source.startsWith("row:")) return;
    const context = resolveCanvasDropContext(event.clientX, event.clientY);
    if (isPalettePayload(source)) {
      const type = paletteTypeFromPayload(source);
      if (!type || !registry.some(entry => entry.type === type)) {
        setError("That widget is not available in the palette.");
        return;
      }
      insertFromPalette(type as WidgetType, context);
      return;
    }
    if (source.startsWith("widget:") && context) {
      dropWidget(source, context.columnId, context.index ?? (
        layout.rows.flatMap(row => row.columns).find(col => col.id === context.columnId)?.children.length ?? 0
      ));
    }
  }
  const selectedControl=useRef<HTMLButtonElement|null>(null);
  const mediaInvoker=useRef<HTMLElement|null>(null);
  const canvasRef=useRef<HTMLDivElement|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [forbidden,setForbidden]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [dirty,setDirty]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [focusMode,setFocusMode]=useState(false);
  const [leftTab,setLeftTab]=useState<"widgets"|"structure"|"templates">("widgets");
  const [widgetQuery,setWidgetQuery]=useState("");
  const [templates,setTemplates]=useState<SiteSectionTemplate[]>([]);
  const [templatesLoading,setTemplatesLoading]=useState(false);
  const [templateName,setTemplateName]=useState("");
  const [templateDialog,setTemplateDialog]=useState(false);
  const [picker,setPicker]=useState<InsertionContext|null>(null);
  const [media,setMedia]=useState<{type?:WidgetType;apply?:(result:MediaPickerResult)=>void}|null>(null);
  const [undo,setUndo]=useState<VisualHistoryEntry[]>([]);
  const [redo,setRedo]=useState<VisualHistoryEntry[]>([]);
  const coalesce=useRef<{key:string;at:number}|null>(null);
  const [serverFields,setServerFields]=useState<Record<string,string[]>>({});
  const [conflict,setConflict]=useState(false);
  const [previewViewport,setPreviewViewport]=useState<PreviewViewport>("desktop");
  const { frameRef: canvasFrameRef, scale: canvasScale } = usePreviewScale(PREVIEW_VIEWPORTS[previewViewport].width, !loading && !!page && layout.rows.length > 0);
  const [selectionBox,setSelectionBox]=useState<{top:number;left:number;width:number;height:number}|null>(null);
  const [pendingWorkflow,setPendingWorkflow]=useState<{action:WorkflowAction;etag:string}|null>(null);
  const [workflowComment,setWorkflowComment]=useState("");
  const [workflowError,setWorkflowError]=useState("");
  const [workflowPreview,setWorkflowPreview]=useState<SitePagePreview|null>(null);
  const [workflowBusy,setWorkflowBusy]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const invoker=useRef<HTMLElement|null>(null);
  const focusButton=useRef<HTMLButtonElement>(null);
  const alive=useRef(true);
  const workflowSequence=useRef(0);
  const backHref=`/sites/${siteId}/admin/pages`;

  useEffect(()=>{
    alive.current=true;
    return ()=>{alive.current=false;};
  },[]);
  useEffect(()=>{
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return ()=>{ document.body.style.overflow = previousOverflow; };
  },[]);
  useEffect(()=>{
    let current=true;setLoading(true);setError(null);setForbidden(false);
    void getSiteVisualDraft(siteId,pageId).then(result=>{
      if(!current)return;
      if(!result.ok){setForbidden([401,403,404].includes(result.error.status));throw new Error(result.error.message);}
      if(result.data.site!==siteId || result.data.id!==pageId)throw new Error("The Page does not belong to this editing context.");
      const record=result.data;
      if(!record.etag)throw new Error("The Page did not return a revision token. Reload before editing.");
      const saved=record.metadata?.visual_layout;
      const initial=saved===undefined ? adaptLegacyBlocks((record.blocks??[]).map(block=>({...block}))) : saved;
      const checked=validateVisualLayout(initial);
      if(!checked.ok)throw new Error("This Page uses an unsupported or invalid layout. Its saved content has not been changed.");
      setPage(record);setLayout(checked.value);setSelected(null);setDirty(false);setUndo([]);setRedo([]);coalesce.current=null;setServerFields({});setConflict(false);
    }).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:"The Page could not be loaded.");})
      .finally(()=>{if(current){setLoading(false);}});
    return ()=>{current=false;};
  },[siteId,pageId,attempt]);
  useEffect(()=>{if(!loading && page)heading.current?.focus();},[loading,page]);
  useEffect(()=>{
    let current=true;
    setTemplatesLoading(true);
    void listSiteSectionTemplates(siteId).then(result=>{
      if(!current)return;
      if(result.ok) setTemplates(result.data);
    }).finally(()=>{if(current)setTemplatesLoading(false);});
    return ()=>{current=false;};
  },[siteId,pageId]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  useEffect(()=>()=>{workflowSequence.current++;},[]);

  function change(next:VisualLayout, options?: { selection?: string|null; coalesceKey?: string }) {
    if(saving)return;
    const now=Date.now();
    const canCoalesce=Boolean(
      options?.coalesceKey
      && coalesce.current?.key===options.coalesceKey
      && now-(coalesce.current?.at??0)<VISUAL_HISTORY_COALESCE_MS,
    );
    if(!canCoalesce){
      setUndo(values=>pushHistory(values,{layout:structuredClone(layout),selected}));
      setRedo([]);
    }
    coalesce.current=options?.coalesceKey ? {key:options.coalesceKey,at:now} : null;
    setLayout(next);
    if(options && "selection" in options) setSelected(options.selection??null);
    setDirty(true);setMessage("");setError(null);setServerFields({});setConflict(false);
  }
  function undoEdit() {
    if(!undo.length || saving)return;
    const entry=undo[undo.length-1]!;
    setRedo(values=>[{layout:structuredClone(layout),selected},...values]);
    setUndo(values=>values.slice(0,-1));
    setLayout(entry.layout);setSelected(entry.selected);setDirty(true);setMessage("");setError(null);setServerFields({});
    coalesce.current=null;
    setAnnouncement("Undid the last visual edit.");
  }
  function redoEdit() {
    if(!redo.length || saving)return;
    const entry=redo[0]!;
    setUndo(values=>pushHistory(values,{layout:structuredClone(layout),selected}));
    setRedo(values=>values.slice(1));
    setLayout(entry.layout);setSelected(entry.selected);setDirty(true);setMessage("");setError(null);setServerFields({});
    coalesce.current=null;
    setAnnouncement("Redid the visual edit.");
  }
  function onWorkspaceKeyDown(event:KeyboardEvent<HTMLDivElement>) {
    if(event.key==="Escape" && focusMode && !picker && !media){setFocusMode(false);focusButton.current?.focus();return;}
    const action=historyShortcut(event.nativeEvent);
    if(!action)return;
    if(!page || !["DRAFT","UNPUBLISHED"].includes(page.status))return;
    event.preventDefault();
    if(action==="undo") undoEdit();
    else redoEdit();
  }
  function leaveBuilder() {
    if(saving || workflowBusy)return;
    if(!dirty || window.confirm("Discard unsaved visual draft changes?")) router.push(backHref);
  }
  function applyComposition(result: ReturnType<typeof moveRow>, options?: { restoreFocus?: boolean }) {
    setAnnouncement(result.announcement);
    if (!result.ok) {
      setError(result.announcement);
      return false;
    }
    change(result.layout,{selection:result.focusId});
    setError(null);
    if (options?.restoreFocus !== false) {
      window.setTimeout(() => {
        const control = document.querySelector<HTMLElement>(`[data-focus-id="${result.focusId}"]`);
        (control ?? selectedControl.current ?? heading.current)?.focus();
      }, 0);
    }
    return true;
  }
  const entries=outline(layout);
  const entry=entries.find(value=>value.id===selected);
  const checked=validateVisualLayout(layout);
  const errors={...(!checked.ok?checked.errors:{}),...serverFields};
  const editable=page && ["DRAFT","UNPUBLISHED"].includes(page.status);

  useLayoutEffect(()=>{
    if(!selected || !canvasRef.current){setSelectionBox(null);return;}
    const node=canvasRef.current.querySelector<HTMLElement>(`[data-node-id="${selected.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"]`);
    if(!node){setSelectionBox(null);return;}
    const parent=canvasRef.current.getBoundingClientRect();
    const rect=node.getBoundingClientRect();
    setSelectionBox({
      top:(rect.top-parent.top)/canvasScale+canvasRef.current.scrollTop,
      left:(rect.left-parent.left)/canvasScale+canvasRef.current.scrollLeft,
      width:rect.width/canvasScale,
      height:rect.height/canvasScale,
    });
  },[selected,layout,previewViewport,focusMode,canvasScale]);

  function updateNode(id:string,mutate:(value:TreeEntry["node"])=>void) {
    const next=structuredClone(layout);const target=outline(next).find(value=>value.id===id);
    if(target){mutate(target.node);change(next,{coalesceKey:`props:${id}`});}
  }
  function addRow() {
    if(layout.rows.length>=50){setError("A layout can contain at most 50 rows.");return;}
    const row=newRow();change({...layout,rows:[...layout.rows,row]},{selection:row.id});
    setAnnouncement("Row added.");
  }
  function openPicker(context:InsertionContext,control:HTMLElement) {invoker.current=control;setPicker(context);}
  function defaultInsertContext():InsertionContext|null {
    if(entry?.kind==="column") return {columnId:entry.id};
    if(entry?.kind==="widget") return {columnId:entry.columnId};
    if(entry?.kind==="row") return {columnId:entry.columnId};
    const last=layout.rows.at(-1);
    if(last) return {columnId:last.columns.at(-1)!.id};
    return null;
  }
  function insert(type:WidgetType,asset?:MediaPickerResult,context:InsertionContext|null=picker) {
    if(!context)return;
    if((type==="image"||type==="hero_image") && !asset) {
      if(!permissions.includes("content.media.view")){setError("Media library permission is required to choose an image.");return;}
      setPicker(context);setMedia({type});return;
    }
    try {
      const widget=newWidget(type,asset);change(insertWidget(layout,context,widget),{selection:widget.id});
      setPicker(null);setMedia(null);setAnnouncement(`${labelFor(type)} added.`);
    }catch(cause){setError(cause instanceof Error?cause.message:"The widget could not be inserted.");}
  }
  function insertFromPalette(type:WidgetType, preferred:InsertionContext|null=null) {
    let nextLayout=layout;
    let context=preferred;
    if(context){
      const column=nextLayout.rows.flatMap(row=>row.columns).find(col=>col.id===context!.columnId);
      if(!column) context=null;
    }
    if(!context){
      context=defaultInsertContext();
    }
    if(!context){
      if(layout.rows.length>=50){setError("A layout can contain at most 50 rows.");return;}
      const row=newRow();
      nextLayout={...layout,rows:[...layout.rows,row]};
      context={columnId:row.columns[0]!.id};
    }
    if((type==="image"||type==="hero_image")) {
      if(!permissions.includes("content.media.view")){setError("Media library permission is required to choose an image.");return;}
      if(nextLayout!==layout) change(nextLayout);
      setPicker(context);setMedia({type});return;
    }
    try {
      const widget=newWidget(type);
      change(insertWidget(nextLayout,context,widget),{selection:widget.id});
      setAnnouncement(`${labelFor(type)} added.`);
    }catch(cause){setError(cause instanceof Error?cause.message:"The widget could not be inserted.");}
  }
  function removeSelected() {
    if(!entry)return;
    applyComposition(removeNode(layout, entry.id));
  }
  function duplicateSelected() {
    if(!entry)return;
    if(entry.kind==="row") applyComposition(duplicateSection(layout,entry.id));
    else if(entry.kind==="widget") applyComposition(duplicateWidget(layout,entry.id));
  }
  function moveSelected(direction:-1|1) {
    if(!entry)return;
    if(entry.kind==="row") applyComposition(moveRow(layout,entry.id,direction));
    else if(entry.kind==="widget") applyComposition(shiftWidget(layout,entry.id,direction));
  }
  async function refreshTemplates() {
    setTemplatesLoading(true);
    try {
      const result=await listSiteSectionTemplates(siteId);
      if(alive.current && result.ok) setTemplates(result.data);
    } finally { if(alive.current) setTemplatesLoading(false); }
  }
  async function saveSelectedAsTemplate() {
    if(!entry || entry.kind!=="row" || saving)return;
    const name=templateName.trim();
    if(!name){setError("Provide a template name.");return;}
    setSaving(true);setError(null);setMessage("");
    try {
      const result=await createSiteSectionTemplate(siteId,name,entry.node as LayoutSection);
      if(!alive.current)return;
      if(!result.ok) throw new Error(result.error.message);
      setTemplateDialog(false);setTemplateName("");
      setMessage(`Section template “${result.data.name}” saved for this Site.`);
      await refreshTemplates();
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"The section template could not be saved.");}
    finally{if(alive.current)setSaving(false);}
  }
  async function insertTemplate(templateId:string) {
    if(!page?.etag || saving || dirty){
      if(dirty) setError("Save your draft before inserting a section template.");
      return;
    }
    setSaving(true);setError(null);setMessage("");setConflict(false);
    try {
      const result=await insertSiteSectionTemplate(siteId,pageId,page.etag,templateId);
      if(!alive.current)return;
      if(!result.ok){
        const details=result.error.details as {fields?:Record<string,string[]>}|null;
        setServerFields(details?.fields??{});
        if(result.error.status===409){
          setConflict(true);
          throw new Error("A newer draft was saved elsewhere. Reload before inserting a template.");
        }
        throw new Error(result.error.message);
      }
      if(result.data.site!==siteId || result.data.id!==pageId) throw new Error("The insert returned a different Page context.");
      const canonical=validateVisualLayout(result.data.metadata?.visual_layout);
      if(!result.data.etag || !canonical.ok) throw new Error("The server did not return a complete layout after insert.");
      setPage(result.data);setLayout(canonical.value);setDirty(false);setUndo([]);setRedo([]);coalesce.current=null;setServerFields({});
      const inserted=canonical.value.rows.at(-1);
      setSelected(inserted?.id??null);
      setMessage("Section template inserted with new component IDs. The source template is unchanged.");
      setAnnouncement("Section template inserted.");
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"The section template could not be inserted.");}
    finally{if(alive.current)setSaving(false);}
  }
  async function save() {
    if(!page?.etag || !checked.ok || saving)return;
    setSaving(true);setError(null);setMessage("");setConflict(false);
    try {
      const result=await saveSiteVisualDraft(siteId,pageId,page.etag,checked.value);
      if(!alive.current)return;
      if(!result.ok){
        const details=result.error.details as {fields?:Record<string,string[]>}|null;
        setServerFields(details?.fields??{});
        if(result.error.status===409){
          setConflict(true);
          throw new Error("A newer draft was saved elsewhere. Your local layout is preserved. Reload the server draft to refresh the revision token, or adopt the server version.");
        }
        throw new Error(result.error.message);
      }
      if(result.data.site!==siteId || result.data.id!==pageId)throw new Error("The save returned a different Page context.");
      const canonical=validateVisualLayout(result.data.metadata?.visual_layout);
      if(!result.data.etag || !canonical.ok)throw new Error("The server did not return a complete saved draft. Reopen this Page to verify the result before saving again.");
      setPage(result.data);setLayout(canonical.value);setDirty(false);setServerFields({});setConflict(false);setMessage("Visual draft saved. The public revision is unchanged.");
      return result.data;
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"The draft could not be saved.");}
    finally{if(alive.current)setSaving(false);}
  }
  async function openPreview() {
    if(!page || saving || workflowBusy || !checked.ok)return;
    const target=window.open("about:blank","_blank");
    if(!target){setError("Allow pop-ups for this Site to open the Page preview.");return;}
    target.opener=null;
    const saved=dirty ? await save() : page;
    if(!saved){target.close();return;}
    target.location.replace(`${APP_BASE_PATH}/sites/${siteId}/admin/pages/${saved.id}/preview?revision=${saved.revision_number}`);
  }
  async function reloadServerDraft() {
    if(!page || saving)return;
    setSaving(true);setError(null);
    try {
      const result=await getSiteVisualDraft(siteId,pageId);
      if(!alive.current)return;
      if(!result.ok)throw new Error(result.error.message);
      if(result.data.site!==siteId || result.data.id!==pageId || !result.data.etag)throw new Error("The Page revision is unavailable. Keep your local edits and try again.");
      setPage(result.data);setConflict(false);
      setMessage("Server draft reloaded. Your local layout is still here — Save draft to overwrite with your version, or Adopt server draft to discard local edits.");
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"The latest draft could not be loaded.");}
    finally{if(alive.current)setSaving(false);}
  }
  async function adoptServerDraft() {
    if(!page || saving)return;
    setSaving(true);setError(null);
    try {
      const result=await getSiteVisualDraft(siteId,pageId);
      if(!alive.current)return;
      if(!result.ok)throw new Error(result.error.message);
      if(result.data.site!==siteId || result.data.id!==pageId || !result.data.etag)throw new Error("The Page revision is unavailable.");
      const saved=result.data.metadata?.visual_layout;
      const initial=saved===undefined ? adaptLegacyBlocks((result.data.blocks??[]).map(block=>({...block}))) : saved;
      const checkedLayout=validateVisualLayout(initial);
      if(!checkedLayout.ok)throw new Error("The server draft uses an unsupported layout and was not adopted.");
      setPage(result.data);setLayout(checkedLayout.value);setDirty(false);setUndo([]);setRedo([]);coalesce.current=null;setServerFields({});setConflict(false);
      setMessage("Adopted the server draft. Local unsaved edits were discarded.");
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"The server draft could not be adopted.");}
    finally{if(alive.current)setSaving(false);}
  }
  async function editPublished() {
    if(!page?.etag)return;setSaving(true);setError(null);
    try{
      const draft=unwrap(await openWorkingDraft(siteId,page.id,page.etag));
      if(alive.current && draft.site===siteId)router.push(`/sites/${siteId}/admin/pages/${draft.id}/builder`);
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"The working draft could not be opened.");}
    finally{if(alive.current)setSaving(false);}
  }
  async function queueWorkflow(action:WorkflowAction) {
    if(!page?.etag)return;
    if(dirty){setError("Save your draft before using CMS workflow actions.");return;}
    const sequence=++workflowSequence.current;
    setWorkflowComment("");setWorkflowError("");setWorkflowPreview(null);
    setPendingWorkflow({action,etag:page.etag});
    if(page.metadata?.visual_layout && (action==="approve" || action==="publish" || action==="revise")) {
      setWorkflowBusy(true);
      try {
        const previewResult=unwrap(await getSitePagePreview(siteId,page.id,page.revision_number));
        if(!alive.current || sequence!==workflowSequence.current)return;
        setWorkflowPreview(previewResult);
        setPendingWorkflow({action,etag:previewResult.etag || page.etag});
      }catch(cause){
        if(alive.current && sequence===workflowSequence.current){
          setWorkflowError(cause instanceof Error?cause.message:"Revision preview could not be loaded.");
          setPendingWorkflow(null);
        }
      }finally{if(alive.current && sequence===workflowSequence.current)setWorkflowBusy(false);}
    }
  }
  async function confirmWorkflow() {
    if(!page || !pendingWorkflow)return;
    setWorkflowBusy(true);setWorkflowError("");
    try {
      const result=await transitionSitePage(siteId,page.id,pendingWorkflow.action,workflowComment.trim(),pendingWorkflow.etag);
      if(!alive.current)return;
      if(!result.ok){
        if(result.error.status===409){
          setWorkflowError("The Page workflow changed before this action completed. Your local draft is unchanged. Reload or return to Pages to reconcile.");
        } else {
          setWorkflowError(result.error.message);
        }
        return;
      }
      if(result.data.site!==siteId || result.data.id!==pageId)throw new Error("The workflow returned a different Page context.");
      setPage(result.data);setPendingWorkflow(null);setWorkflowPreview(null);
      setMessage(`Workflow ${pendingWorkflow.action} completed. Status is now ${result.data.status}.`);
      if(!["DRAFT","UNPUBLISHED"].includes(result.data.status)){setDirty(false);}
    }catch(cause){if(alive.current)setWorkflowError(cause instanceof Error?cause.message:"The workflow action could not be completed.");}
    finally{if(alive.current)setWorkflowBusy(false);}
  }
  const contextLabel=picker ? (()=>{const value=entries.find(item=>item.id===picker.columnId);const row=layout.rows.find(item=>item.columns.some(column=>column.id===picker.columnId));return `${entries.find(item=>item.id===row?.id)?.label??"Row"} / ${value?.label??"Column"}${picker.itemId?" / Layout item":""}`;})():"";
  const preview=page && pageFromResponse(200,{id:page.id,title:page.title,path:page.path,site:page.site,layout:page.layout,seo:page.seo??{},blocks:[],metadata:{...page.metadata,visual_layout:layout}});
  const matchingWidgets=registry.filter(value=>`${value.label} ${value.type}`.toLowerCase().includes(widgetQuery.toLowerCase().trim()));
  const canvasWidth=PREVIEW_VIEWPORTS[previewViewport].width;
  const canMoveSelected=!!entry && entry.kind!=="column";
  const canDuplicateSelected=!!entry && (entry.kind==="row" || entry.kind==="widget");

  if(loading)return <Paper role="status" sx={{p:5,display:"flex",alignItems:"center",gap:2}}><CircularProgress size={24}/>Loading Visual Builder for {siteName}…</Paper>;
  if(!page)return <Alert severity={forbidden?"warning":"error"} action={!forbidden?<Button onClick={()=>setAttempt(value=>value+1)}>Retry</Button>:undefined}>
    {forbidden?"This Page is not available for visual editing in this Site.":error??"The Page could not be loaded."} <Button component={Link} href={backHref}>Back to Pages</Button>
  </Alert>;

  return <Box aria-label="Visual Builder workspace" onKeyDown={onWorkspaceKeyDown} sx={{position:"fixed",inset:0,zIndex:1201,display:"flex",flexDirection:"column",minWidth:0,height:"100dvh",bgcolor:"#eef1f5",overflow:"hidden","& > .MuiAlert-root":{borderRadius:0,flexShrink:0}}}>
    <Paper square elevation={0} sx={{px:2,py:1,display:"flex",alignItems:"center",gap:1.25,flexWrap:"wrap",flexShrink:0,bgcolor:"#1c242c",color:"#f4f7fb",borderBottom:"1px solid #34414d","& .MuiButton-root":{fontSize:12,whiteSpace:"nowrap"},"& .MuiButton-text":{color:"#dbe6f2"},"& .MuiIconButton-root":{color:"#dbe6f2"},"& .Mui-disabled":{color:"#75818d !important"},"& .MuiButton-outlined":{color:"#dbe6f2",borderColor:"#526170"}}}>
      <Box sx={{display:"flex",alignItems:"center",gap:1.25,flex:1,minWidth:180}}>
        <Box sx={{width:32,height:32,borderRadius:2,display:"grid",placeItems:"center",background:"linear-gradient(135deg,#4388ff,#8655ee)",flexShrink:0}}><WidgetsOutlined fontSize="small"/></Box>
        <Box sx={{minWidth:0}}>
          <Typography component="h2" variant="subtitle2" ref={heading} tabIndex={-1} sx={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:240}}>{page.title}</Typography>
          <Typography variant="caption" sx={{color:"#aebdcb",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>{siteName} · Revision {page.revision_number??"—"} · {page.status}</Typography>
        </Box>
      </Box>
      {editable?<>
        <Tooltip title="Undo (Ctrl+Z)"><span><IconButton aria-label="Undo" size="small" disabled={!undo.length || saving} onClick={undoEdit}><UndoOutlined fontSize="small"/></IconButton></span></Tooltip>
        <Tooltip title="Redo (Ctrl+Y)"><span><IconButton aria-label="Redo" size="small" disabled={!redo.length || saving} onClick={redoEdit}><RedoOutlined fontSize="small"/></IconButton></span></Tooltip>
      </>:null}
      <Box role="group" aria-label="Canvas viewport" sx={{display:"flex",gap:0.5}}>
        {(Object.keys(PREVIEW_VIEWPORTS) as PreviewViewport[]).map(key=>(
          <Button key={key} size="small" variant={previewViewport===key?"contained":"outlined"} aria-pressed={previewViewport===key} onClick={()=>setPreviewViewport(key)}>
            {PREVIEW_VIEWPORTS[key].label}
          </Button>
        ))}
      </Box>
      <Chip size="small" label={page.status==="PUBLISHED"?"Published revision":editable?(dirty?"Unsaved changes":"Saved draft"):"Review revision"} color={dirty?"warning":"default"}/>
      <Button onClick={leaveBuilder} disabled={saving || workflowBusy}>Back to Pages</Button>
      <Button size="small" disabled={!checked.ok || saving || workflowBusy} onClick={()=>void openPreview()}>Preview in new tab</Button>
      <Button size="small" onClick={()=>setSelected(null)}>Page settings</Button>
      <ContentWorkflowButtons title={page.title} available={page.available_actions??[]} disabled={saving || workflowBusy || dirty || !page.etag} onAction={(action)=>void queueWorkflow(action)}/>
      {editable?<>
        <Button ref={focusButton} startIcon={focusMode?<FullscreenExit/>:<Fullscreen/>} aria-pressed={focusMode} onClick={()=>setFocusMode(value=>!value)}>{focusMode?"Exit focus mode":"Focus mode"}</Button>
        <Button variant="contained" startIcon={saving?<CircularProgress size={16} color="inherit"/>:<SaveOutlined/>} disabled={!dirty || saving || !checked.ok} onClick={()=>void save()}>{saving?"Saving…":"Save draft"}</Button>
      </>:null}
    </Paper>
    {error?<Alert severity={conflict?"warning":"error"} role="alert" action={conflict?<Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}>
      <Button color="inherit" size="small" disabled={saving} onClick={()=>void reloadServerDraft()}>Reload server draft</Button>
      <Button color="inherit" size="small" disabled={saving} onClick={()=>void adoptServerDraft()}>Adopt server draft</Button>
    </Box>:undefined}>{error}</Alert>:null}
    {message?<Alert severity="success" role="status" sx={{py:0}}>{message}</Alert>:null}
    <Typography component="div" aria-live="polite" sx={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0 0 0 0)"}}>{announcement}</Typography>
    {!editable?<Alert severity="info" action={page.status==="PUBLISHED"?<Button disabled={saving} onClick={()=>void editPublished()}>Open working draft</Button>:undefined}>
      {page.status==="PUBLISHED"?"This is the published Page. Open its private working draft to use the Visual Builder.":"This Page is locked for review. Return to Pages to follow its CMS workflow."}
    </Alert>:<>
      {!page.metadata?.visual_layout && (page.blocks?.length??0)>0?<Alert severity="info" sx={{mb:2}} action={<Button onClick={()=>change(structuredClone(layout))}>Convert legacy draft</Button>}>
        Legacy blocks are shown through the compatibility adapter. Saving converts this draft to a visual layout; revision history and the public snapshot stay intact.
      </Alert>:null}
      <Box sx={{display:{xs:"flex",md:"grid"},flexDirection:"column",flex:1,minHeight:0,overflow:"auto",gridTemplateColumns:focusMode?"minmax(0,1fr)":{md:"240px minmax(0,1fr) 280px",xl:"276px minmax(0,1fr) 312px"},gap:0,alignItems:"stretch"}}>
        {!focusMode?<Paper square variant="outlined" sx={{p:0,minWidth:0,overflow:"hidden",display:"flex",flexDirection:"column",flexShrink:0,height:{xs:300,md:"auto"},borderTop:0,borderBottom:0,"& .MuiTab-root":{minHeight:46,fontSize:12}}}>
          <Tabs value={leftTab} onChange={(_,value: "widgets"|"structure"|"templates")=>setLeftTab(value)} variant="fullWidth" aria-label="Builder library">
            <Tab value="widgets" label="Widgets" id="builder-tab-widgets" aria-controls="builder-panel-widgets"/>
            <Tab value="structure" label="Structure" id="builder-tab-structure" aria-controls="builder-panel-structure"/>
            <Tab value="templates" label="Templates" id="builder-tab-templates" aria-controls="builder-panel-templates"/>
          </Tabs>
          {leftTab==="widgets"?<Box id="builder-panel-widgets" role="tabpanel" aria-labelledby="builder-tab-widgets" sx={{p:1.5,overflow:"auto",minHeight:0}}>
            <TextField size="small" fullWidth label="Search widgets" placeholder="Try Slider, Image or Button" value={widgetQuery} onChange={event=>setWidgetQuery(event.target.value)} sx={{mb:1.5}}/>
            <Typography role="status" variant="caption" component="p" sx={{mb:0.5}}>{matchingWidgets.length} widgets match</Typography>
            <Typography variant="caption" component="p" color="text.secondary" sx={{mb:1}}>Drag onto the live canvas, or click to add at the selection.</Typography>
            {matchingWidgets.length?categories.map(group=>{
              const items=matchingWidgets.filter(value=>group.types.includes(value.type));
              if(!items.length)return null;
              return <Box key={group.label} sx={{mb:2}}>
                <Typography variant="overline" color="text.secondary">{group.label}</Typography>
                <Box sx={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:1,mt:0.5}}>
                  {items.map(value=><Button key={value.type} size="small" variant="outlined" disabled={saving}
                    draggable={!saving}
                    aria-label={`Add ${value.label}. Drag onto the canvas or click to insert.`}
                    onDragStart={event=>{
                      suppressPaletteClick.current=false;
                      startDrag(event, `palette:${value.type}`);
                    }}
                    onDragEnd={()=>{
                      suppressPaletteClick.current=true;
                      finishDrag();
                    }}
                    onClick={()=>{
                      if(suppressPaletteClick.current){suppressPaletteClick.current=false;return;}
                      insertFromPalette(value.type);
                    }}
                    sx={{p:1.25,minHeight:88,textTransform:"none",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:1,borderRadius:1.5,textAlign:"center",borderColor:"#dfe5ec",bgcolor:"#fafbfd",color:"#263d55",cursor:saving?"default":"grab",transition:"background-color 150ms, border-color 150ms, transform 150ms","&:active":{cursor:saving?"default":"grabbing"},"&:hover":{bgcolor:"#edf5ff",borderColor:"#83b7ed",transform:"translateY(-1px)"},"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}}}>
                    <WidgetIcon type={value.type}/>
                    <Typography variant="caption" sx={{fontSize:11,lineHeight:1.3}}>{value.label}</Typography>
                    <Typography variant="caption" sx={{fontSize:9,lineHeight:1.2,letterSpacing:0.4,color:"#58718c"}}>{group.shortLabel}</Typography>
                  </Button>)}
                </Box>
              </Box>;
            }):<Alert severity="info">No widgets match your search. <Button onClick={()=>setWidgetQuery("")}>Clear search</Button></Alert>}
          </Box>:leftTab==="structure"?<Box id="builder-panel-structure" role="tabpanel" aria-labelledby="builder-tab-structure" sx={{p:1.5,overflow:"auto",minHeight:0,bgcolor:"#152033",color:"#e4eaf4",flex:1}}>
            <Box component="nav" aria-label="Nested layout outline">
              <Typography variant="overline" sx={{color:"#9caec6"}}>LAYOUT OUTLINE</Typography>
              <Typography variant="caption" component="p" sx={{mb:1}}>Drag handles to reorder. Drop palette widgets onto a column or widget.</Typography>
              {entries.length===0?<Typography variant="body2">Your layout is empty.</Typography>:entries.map(value=>{
                const canDrag = !saving && (value.kind==="row" || value.kind==="widget") && !value.itemId;
                const payload: VisualDragPayload | null = value.kind==="row" ? `row:${value.id}` : value.kind==="widget" && !value.itemId ? `widget:${value.id}` : null;
                return <Box
                  key={value.id}
                  onDragOver={event=>{
                    const active=dragId.current;
                    if(saving || !active) return;
                    if(value.kind==="row" && active.startsWith("row:")) allowVisualDrop(event, active);
                    if((value.kind==="column" || (value.kind==="widget" && !value.itemId)) && (active.startsWith("widget:") || active.startsWith("palette:"))) {
                      allowVisualDrop(event, active);
                    }
                  }}
                  onDrop={event=>{
                    if (saving) return;
                    allowVisualDrop(event, dragId.current);
                    const source = dropPayload(event);
                    if (!source) return;
                    if (value.kind==="row" && source.startsWith("row:") && source!==`row:${value.id}`) {
                      const order=layout.rows.map(row=>row.id);
                      const from=order.indexOf(source.slice(4));
                      const to=order.indexOf(value.id);
                      if(from<0 || to<0){applyComposition({ok:false,layout,announcement:"Invalid row drop target."});return;}
                      order.splice(from,1);order.splice(to,0,source.slice(4));
                      applyComposition(reorderRowsByIds(layout,order));
                      return;
                    }
                    if (value.kind==="column") {
                      dropWidget(source, value.id, (value.node as LayoutColumn).children.length);
                      return;
                    }
                    if (value.kind==="widget" && !value.itemId) {
                      const target=outline(layout).find(entry=>entry.id===value.id);
                      if (!target || target.kind!=="widget") return;
                      const column=layout.rows.flatMap(row=>row.columns).find(col=>col.id===target.columnId);
                      const index=column?.children.findIndex(child=>child.id===value.id) ?? -1;
                      if (!column || index<0) return;
                      dropWidget(source, column.id, index);
                    }
                  }}
                  sx={{display:"flex",alignItems:"center",gap:0.25,pl:value.depth*1.5,bgcolor:selected===value.id?"#304c70":undefined,borderLeft:selected===value.id?"3px solid #79baff":"3px solid transparent"}}
                >
                  {canDrag && payload?<IconButton
                    size="small"
                    draggable
                    aria-label={`Drag ${value.label}`}
                    onDragStart={event=>startDrag(event, payload)}
                    onDragEnd={finishDrag}
                    sx={{color:"#9caec6",cursor:"grab","&:active":{cursor:"grabbing"}}}
                  ><DragIndicator fontSize="inherit"/></IconButton>:<Box sx={{width:28,flexShrink:0}}/>}
                  <Button size="small" fullWidth
                    aria-label={`Select ${value.label} ${value.id}`} aria-pressed={selected===value.id}
                    onClick={()=>setSelected(value.id)}
                    sx={{justifyContent:"flex-start",color:"inherit",textTransform:"none",overflowWrap:"anywhere",minWidth:0}}>
                    {value.depth>1?"↳ ":""}{value.label}
                  </Button>
                </Box>;
              })}
              <Divider sx={{my:2,borderColor:"#39465a"}}/>
              <Button startIcon={<AddRounded/>} fullWidth disabled={saving} onClick={addRow} sx={{color:"#afd4ff"}}>Add row</Button>
            </Box>
          </Box>:<Box id="builder-panel-templates" role="tabpanel" aria-labelledby="builder-tab-templates" sx={{p:1.5,overflow:"auto",minHeight:0}}>
            <Typography variant="overline" color="text.secondary">SITE TEMPLATES</Typography>
            <Typography variant="caption" component="p" sx={{mb:1.5}}>Insert clones with new IDs. Save a selected row from the inspector.</Typography>
            {templatesLoading?<Box sx={{display:"flex",justifyContent:"center",py:3}}><CircularProgress size={20}/></Box>:null}
            {!templatesLoading && templates.length===0?<Typography variant="body2" color="text.secondary">No active section templates for this Site yet.</Typography>:null}
            <Box sx={{display:"grid",gap:1}}>
              {templates.map(template=><Button key={template.id} variant="outlined" disabled={saving || dirty}
                onClick={()=>void insertTemplate(template.id)}
                sx={{justifyContent:"flex-start",textTransform:"none",flexDirection:"column",alignItems:"flex-start",gap:0.25,py:1.25}}>
                <Typography variant="body2" fontWeight={700}>{template.name}</Typography>
                <Typography variant="caption" color="text.secondary">v{template.version} · schema {template.schema_version}</Typography>
              </Button>)}
            </Box>
            {dirty?<Typography variant="caption" color="warning.main" component="p" sx={{mt:1}}>Save the draft before inserting a template.</Typography>:null}
          </Box>}
        </Paper>:null}
        <Box sx={{minWidth:0,minHeight:{xs:480,md:0},flexShrink:0,overflow:{xs:"visible",md:"auto"},p:{xs:1.5,lg:3},backgroundImage:"repeating-linear-gradient(135deg,rgba(118,137,155,.045) 0 10px,transparent 10px 20px)"}}>
          <Box sx={{display:"flex",gap:1,mb:2,flexWrap:"wrap",alignItems:"center"}}>
            <Typography variant="overline" sx={{flex:1}}>LIVE CANVAS · {PREVIEW_VIEWPORTS[previewViewport].label}</Typography>
            <Button size="small" startIcon={<AddRounded/>} disabled={saving} onClick={addRow}>Add row</Button>
          </Box>
          {layout.rows.length===0?<Paper
            variant="outlined"
            data-testid="builder-empty-dropzone"
            onDragOver={event=>{
              const active=dragId.current;
              if(active && (active.startsWith("palette:") || active.startsWith("widget:"))) {
                allowVisualDrop(event, active);
                setDropHoverColumn("__empty__");
              }
            }}
            onDragLeave={event=>{
              if(!event.currentTarget.contains(event.relatedTarget as Node)) setDropHoverColumn(null);
            }}
            onDrop={event=>{
              allowVisualDrop(event, dragId.current);
              const source=dropPayload(event);
              setDropHoverColumn(null);
              if(isPalettePayload(source)){
                const type=paletteTypeFromPayload(source);
                if(!type || !registry.some(entry=>entry.type===type)){setError("That widget is not available in the palette.");return;}
                insertFromPalette(type as WidgetType, null);
              }
            }}
            sx={{py:8,px:3,textAlign:"center",borderStyle:"dashed",borderRadius:3,borderColor:dropHoverColumn==="__empty__"?"primary.main":undefined,bgcolor:dropHoverColumn==="__empty__"?"rgba(34,115,185,.06)":undefined}}
          >
            <WidgetsOutlined sx={{fontSize:44,color:"primary.main",mb:2}}/>
            <Typography variant="h6">Start composing your Page</Typography>
            <Typography color="text.secondary" sx={{my:1}}>Drag a widget here, add a row, or explore a sample layout.</Typography>
            <Button variant="contained" onClick={addRow}>Add your first row</Button>
            <Button onClick={()=>{const value=starterLayout();change(value,{selection:null});}}>Use sample starter</Button>
          </Paper>:<>
            <Box component="details" open sx={{mb:2,"& > summary":{cursor:"pointer",fontSize:12,fontWeight:600,color:"#486078",py:1,"&:focus-visible":{outline:"2px solid #2273b9"}}}}>
            <Box component="summary">Row layout controls</Box>
            <Box aria-label="Dark row editor" sx={{display:"grid",gap:1,mt:1}}>{layout.rows.map((row,i)=><Paper
              key={row.id}
              onDragOver={event=>{
                if(dragId.current?.startsWith("row:")) allowVisualDrop(event, dragId.current);
              }}
              onDrop={event=>{
                allowVisualDrop(event, dragId.current);
                const source=dropPayload(event);
                if(!source?.startsWith("row:") || source===`row:${row.id}`)return;
                const order=layout.rows.map(value=>value.id);
                const from=order.indexOf(source.slice(4));
                const to=order.indexOf(row.id);
                if(from<0 || to<0){applyComposition({ok:false,layout,announcement:"Invalid row drop target."});return;}
                order.splice(from,1);order.splice(to,0,source.slice(4));
                applyComposition(reorderRowsByIds(layout,order));
              }}
              sx={{p:1.5,bgcolor:"#152033",color:"#edf3ff",borderRadius:2}}>
              <Box sx={{display:"flex",gap:1,alignItems:"center",flexWrap:"wrap",mb:1}}>
                <IconButton size="small" draggable={!saving} disabled={saving} aria-label={`Drag row ${i+1}`}
                  onDragStart={event=>startDrag(event, `row:${row.id}`)} onDragEnd={finishDrag}
                  sx={{color:"#afd4ff",cursor:saving?"default":"grab","&:active":{cursor:"grabbing"}}}><DragIndicator fontSize="inherit"/></IconButton>
                <Button data-focus-id={row.id} sx={{color:"inherit"}} onClick={()=>setSelected(row.id)} aria-pressed={selected===row.id}>Row {i+1}</Button>
                {([-1,1] as const).map(direction=><Button key={direction} size="small" sx={{color:"#afd4ff",minWidth:32}}
                  data-focus-id={row.id}
                  aria-label={`Move row ${i+1} ${direction<0?"up":"down"}`} disabled={saving || i+direction<0 || i+direction>=layout.rows.length}
                  onClick={()=>applyComposition(moveRow(layout,row.id,direction))}>{direction<0?"↑":"↓"}</Button>)}
                <Button size="small" sx={{color:"#afd4ff"}} disabled={saving} aria-label={`Duplicate row ${i+1}`}
                  onClick={()=>applyComposition(duplicateSection(layout,row.id))}>Duplicate</Button>
                <TextField select size="small" label={`Row ${i+1} columns`} value={JSON.stringify(row.ratios)} disabled={saving}
                  onChange={event=>{
                    const next=JSON.parse(event.target.value) as LayoutSection["ratios"];
                    applyComposition(resizeColumns(layout,row.id,next));
                  }}
                  sx={{minWidth:150,"& .MuiInputBase-root":{color:"#edf3ff"},"& .MuiInputLabel-root":{color:"#b3c4da"},"& .MuiOutlinedInput-notchedOutline":{borderColor:"#68788d"},"& .MuiSvgIcon-root":{color:"#b3c4da"}}}>
                  {ratios.map(value=><MenuItem key={JSON.stringify(value)} value={JSON.stringify(value)}>{value.length===1?"1 column":value.length===3?"3 equal columns":`${value[0]} / ${value[1]}`}</MenuItem>)}
                </TextField>
              </Box>
              <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",sm:row.ratios.map(value=>`minmax(0,${value}fr)`).join(" ")},gap:1}}>
                {row.columns.map((column,j)=><Box key={column.id}
                  onDragOver={event=>{
                    const active=dragId.current;
                    if(active && (active.startsWith("widget:") || active.startsWith("palette:"))) allowVisualDrop(event, active);
                  }}
                  onDrop={event=>{
                    allowVisualDrop(event, dragId.current);
                    dropWidget(dropPayload(event), column.id, column.children.length);
                  }}
                  sx={{border:"1px dashed #6f83a1",borderRadius:1,p:1,minWidth:0,display:"grid",gap:0.5,bgcolor:dropHoverColumn===column.id?"rgba(121,186,255,.12)":undefined}}>
                  <Button data-focus-id={column.id} sx={{color:"#c5d9f3"}} size="small" onClick={()=>setSelected(column.id)}>Column {j+1} · {column.children.length} widgets</Button>
                  <Button fullWidth size="small" startIcon={<AddRounded/>} sx={{color:"#afd4ff"}} disabled={saving}
                    onClick={event=>openPicker({columnId:column.id,index:0},event.currentTarget)}
                    aria-label={`Add here at start of row ${i+1} column ${j+1}`}>Add here</Button>
                  {column.children.map((widget,widgetIndex)=><Box key={widget.id}
                    onDragOver={event=>{
                      const active=dragId.current;
                      if(active && (active.startsWith("widget:") || active.startsWith("palette:"))) allowVisualDrop(event, active);
                    }}
                    onDrop={event=>{
                      allowVisualDrop(event, dragId.current);
                      const source=dropPayload(event);
                      if(!source || source===`widget:${widget.id}`)return;
                      dropWidget(source, column.id, widgetIndex);
                    }}
                    sx={{display:"grid",gap:0.5,p:0.75,border:"1px solid #3d516b",borderRadius:1}}>
                    <Box sx={{display:"flex",alignItems:"center",gap:0.5,minWidth:0}}>
                      <IconButton size="small" draggable={!saving} disabled={saving} aria-label={`Drag ${labelFor(widget.type)}`}
                        onDragStart={event=>startDrag(event, `widget:${widget.id}`)} onDragEnd={finishDrag}
                        sx={{color:"#afd4ff",cursor:saving?"default":"grab","&:active":{cursor:"grabbing"}}}><DragIndicator fontSize="inherit"/></IconButton>
                      <Button data-focus-id={widget.id} size="small" sx={{color:"#edf3ff",justifyContent:"flex-start",textTransform:"none",minWidth:0,flex:1}}
                        aria-pressed={selected===widget.id} onClick={()=>setSelected(widget.id)}>{labelFor(widget.type)}</Button>
                    </Box>
                    <Box sx={{display:"flex",gap:0.5,flexWrap:"wrap"}}>
                      <Button size="small" sx={{color:"#afd4ff",minWidth:32}} data-focus-id={widget.id}
                        aria-label={`Move ${labelFor(widget.type)} up`} disabled={saving || widgetIndex===0}
                        onClick={()=>applyComposition(shiftWidget(layout,widget.id,-1))}>↑</Button>
                      <Button size="small" sx={{color:"#afd4ff",minWidth:32}} data-focus-id={widget.id}
                        aria-label={`Move ${labelFor(widget.type)} down`} disabled={saving || widgetIndex===column.children.length-1}
                        onClick={()=>applyComposition(shiftWidget(layout,widget.id,1))}>↓</Button>
                      <Button size="small" sx={{color:"#afd4ff"}} disabled={saving}
                        onClick={event=>openPicker({columnId:column.id,index:widgetIndex+1},event.currentTarget)}
                        aria-label={`Add here after ${labelFor(widget.type)}`}>Add here</Button>
                    </Box>
                  </Box>)}
                  <Button fullWidth size="small" startIcon={<AddRounded/>} sx={{color:"#afd4ff"}} disabled={saving}
                    onClick={event=>openPicker({columnId:column.id},event.currentTarget)}
                    aria-label={`Add widget to row ${i+1} column ${j+1}`}>Add widget</Button>
                </Box>)}
              </Box>
            </Paper>)}</Box>
            </Box>
            <Box
              ref={canvasFrameRef}
              data-testid="live-canvas-drop-frame"
              onDragOver={event=>{
                acceptCanvasDrag(event);
              }}
              onDragLeave={event=>{
                if(!event.currentTarget.contains(event.relatedTarget as Node)) setDropHoverColumn(null);
              }}
              onDrop={event=>{
                handleCanvasDrop(event);
              }}
              sx={{
                py:1,
              }}
            >
              <Paper
                ref={canvasRef}
                component="section"
                aria-label="Live Page canvas"
                data-preview-scale={canvasScale}
                tabIndex={0}
                variant="outlined"
                onClick={event=>{
                  const target=(event.target as HTMLElement).closest<HTMLElement>("[data-node-id]");
                  if(target){event.preventDefault();setSelected(target.dataset.nodeId??null);}
                }}
                onDragOver={event=>{
                  acceptCanvasDrag(event);
                }}
                onDrop={event=>{
                  handleCanvasDrop(event);
                }}
                sx={{
                  position:"relative",
                  mx:"auto",
                  width:canvasWidth,
                  zoom:canvasScale,
                  p:{xs:2,md:3},
                  minHeight:"calc(100dvh - 220px)",
                  bgcolor:"white",
                  borderRadius:1.5,
                  boxShadow:"0 8px 40px rgba(32,51,73,.12)",
                  overflowWrap:"anywhere",
                  outline:dropHoverColumn && dropHoverColumn!=="__empty__"?"2px dashed #83b7ed":undefined,
                  outlineOffset:4,
                  ...(dropHoverColumn && dropHoverColumn!=="__empty__"?{[`& [data-node-id="${dropHoverColumn}"]`]:{outline:"2px dashed #2273b9",outlineOffset:2,borderRadius:1,backgroundColor:"rgba(34,115,185,.06)"}}:{}),
                  ...(selected?{[`& [data-node-id="${selected}"]`]:{outline:"2px solid #2273b9",outlineOffset:2,borderRadius:1}}:{})
                }}
              >
                {checked.ok && preview?<PublicPageView page={preview} privateMediaBase={`${APP_BASE_PATH}/sites/${siteId}/media`} viewportWidth={canvasWidth} hideTitle={layout.settings?.show_title===undefined}/>:<Alert severity="warning">Complete the highlighted inspector fields to preview this layout.</Alert>}
                {selectionBox && entry && entry.kind!=="column"?<Box
                  data-testid="canvas-selection-chrome"
                  sx={{
                    pointerEvents:"none",
                    position:"absolute",
                    top:selectionBox.top-4,
                    left:selectionBox.left-4,
                    width:selectionBox.width+8,
                    height:selectionBox.height+8,
                    border:"2px solid #2273b9",
                    borderRadius:1,
                    zIndex:2,
                  }}
                >
                  <Chip
                    size="small"
                    label={entry.label}
                    color="primary"
                    sx={{position:"absolute",top:-12,left:8,height:22,fontSize:11,pointerEvents:"none"}}
                  />
                  <Box sx={{position:"absolute",top:-16,right:4,display:"flex",gap:0.25,pointerEvents:"auto",bgcolor:"background.paper",borderRadius:1,boxShadow:1,border:"1px solid",borderColor:"divider"}}>
                    {(entry.kind==="row" || entry.kind==="widget") && !entry.itemId?<Tooltip title="Drag to reorder"><span><IconButton size="small" draggable={!saving} disabled={saving}
                      aria-label={`Canvas drag ${entry.label}`}
                      onDragStart={event=>startDrag(event, entry.kind==="row" ? `row:${entry.id}` : `widget:${entry.id}`)}
                      onDragEnd={finishDrag}
                      sx={{cursor:saving?"default":"grab","&:active":{cursor:"grabbing"}}}
                    ><DragIndicator fontSize="inherit"/></IconButton></span></Tooltip>:null}
                    <Tooltip title="Move up"><span><IconButton size="small" aria-label={`Canvas move ${entry.label} up`} disabled={saving || !canMoveSelected} onClick={event=>{event.stopPropagation();moveSelected(-1);}}><ArrowUpward fontSize="inherit"/></IconButton></span></Tooltip>
                    <Tooltip title="Move down"><span><IconButton size="small" aria-label={`Canvas move ${entry.label} down`} disabled={saving || !canMoveSelected} onClick={event=>{event.stopPropagation();moveSelected(1);}}><ArrowDownward fontSize="inherit"/></IconButton></span></Tooltip>
                    <Tooltip title="Duplicate"><span><IconButton size="small" aria-label={`Canvas duplicate ${entry.label}`} disabled={saving || !canDuplicateSelected} onClick={event=>{event.stopPropagation();duplicateSelected();}}><ContentCopyOutlined fontSize="inherit"/></IconButton></span></Tooltip>
                    <Tooltip title="Delete"><span><IconButton size="small" color="error" aria-label={`Canvas delete ${entry.label}`} disabled={saving} onClick={event=>{event.stopPropagation();removeSelected();}}><DeleteOutline fontSize="inherit"/></IconButton></span></Tooltip>
                  </Box>
                </Box>:null}
              </Paper>
            </Box>
          </>}
        </Box>
        {!focusMode?<Paper square component="aside" aria-label="Widget inspector" variant="outlined" sx={{p:2,minWidth:0,minHeight:{xs:300,md:0},flexShrink:0,overflow:{xs:"visible",md:"auto"},borderTop:0,borderBottom:0,"& .MuiInputBase-root":{fontSize:13},"& .MuiTypography-h6":{fontSize:17},"& .MuiFormLabel-root":{fontSize:13}}}>
          <Typography variant="overline" color="text.secondary">Properties</Typography>
          {entry?<>
            <Typography variant="h6" sx={{mb:1}}>{entry.label}</Typography>
            <Typography variant="caption" color="text.secondary">{entry.kind==="widget"?categories.find(group=>group.types.includes((entry.node as WidgetNode).type))?.label:"Layout"}</Typography>
            {entry.kind==="widget"?<Box key={entry.id} sx={{mt:2}}>
              <InspectorFields
                schema={schemaFor((entry.node as WidgetNode).type)}
                value={(entry.node as WidgetNode).props}
                disabled={saving}
                path={widgetPropsPath(layout, entry.id) ?? undefined}
                errors={errors}
                onChange={value=>updateNode(entry.id,node=>{(node as WidgetNode).props=value as WidgetNode["props"];})}
                chooseImage={permissions.includes("content.media.view")?(apply=>{
                  mediaInvoker.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
                  setMedia({apply});
                }):undefined}
              />
              {nestedItems(entry.node as WidgetNode).map((item,index)=><Button key={item.id} size="small" disabled={saving} onClick={event=>openPicker({columnId:entry.columnId,widgetId:entry.id,itemId:item.id},event.currentTarget)}>Add content to item {index+1}</Button>)}
            </Box>:<Typography variant="body2" sx={{my:2}}>Use the row controls to choose columns and insert content. Sections cannot be nested.</Typography>}
            {entry.kind!=="column"?<Box sx={{display:"grid",gap:2,mt:2}}><Typography variant="subtitle2">Presentation</Typography>
              <InspectorFields schema={presentationSchema} value={(entry.node as WidgetNode|LayoutSection).style??{}} disabled={saving}
                onChange={value=>updateNode(entry.id,node=>{if(node.type!=="column")node.style=value as LayoutStyle;})}/>
              <Typography variant="subtitle2">Breakpoint overrides</Typography>
              <Typography variant="caption" color="text.secondary">Desktop uses Presentation above. Tablet and Mobile may override spacing{entry.kind==="row"?" and column stacking":""}. Inherit restores the wider value.</Typography>
              {LAYOUT_OVERRIDE_BREAKPOINTS.map((breakpoint) => {
                const node = entry.node as WidgetNode | LayoutSection;
                const responsive = node.responsive;
                const gapValue = responsive?.[breakpoint]?.gap;
                const stackValue = entry.kind === "row" ? (responsive as SectionResponsive | undefined)?.[breakpoint]?.stack : undefined;
                return <Box key={breakpoint} sx={{display:"grid",gap:1,p:1.25,border:"1px solid",borderColor:"divider",borderRadius:1}}>
                  <Typography variant="caption" sx={{fontWeight:700,textTransform:"uppercase"}}>{breakpoint}</Typography>
                  <TextField select size="small" label={`${human(breakpoint)} spacing`} disabled={saving}
                    value={gapValue ?? "inherit"}
                    onChange={event=>{
                      const next = event.target.value;
                      updateNode(entry.id, current => {
                        if (current.type === "column") return;
                        if (next === "inherit") {
                          const cleaned = resetResponsiveProperty(current.responsive as SectionResponsive | WidgetResponsive | undefined, breakpoint, "gap");
                          if (cleaned) current.responsive = cleaned;
                          else delete current.responsive;
                        } else {
                          current.responsive = setResponsiveProperty(current.responsive as SectionResponsive | WidgetResponsive | undefined, breakpoint, "gap", next as GapToken);
                        }
                      });
                    }}>
                    <MenuItem value="inherit">Inherit</MenuItem>
                    {(["none","sm","md","lg"] as const).map(value=><MenuItem key={value} value={value}>{human(value)}</MenuItem>)}
                  </TextField>
                  {entry.kind==="row"?<TextField select size="small" label={`${human(breakpoint)} columns`} disabled={saving}
                    value={stackValue === undefined ? "inherit" : stackValue ? "stack" : "side"}
                    onChange={event=>{
                      const next = event.target.value;
                      updateNode(entry.id, current => {
                        if (current.type !== "section") return;
                        if (next === "inherit") {
                          const cleaned = resetResponsiveProperty(current.responsive, breakpoint as LayoutOverrideBreakpoint, "stack");
                          if (cleaned) current.responsive = cleaned;
                          else delete current.responsive;
                        } else {
                          current.responsive = setResponsiveProperty(current.responsive, breakpoint as LayoutOverrideBreakpoint, "stack", next === "stack");
                        }
                      });
                    }}>
                    <MenuItem value="inherit">Inherit</MenuItem>
                    <MenuItem value="stack">Stack columns</MenuItem>
                    <MenuItem value="side">Side by side</MenuItem>
                  </TextField>:null}
                </Box>;
              })}
            </Box>:null}
            {entry.kind==="row"?<>
              <Button size="small" disabled={saving} sx={{mt:1}} onClick={()=>applyComposition(duplicateSection(layout,entry.id))}>Duplicate section</Button>
              <Button size="small" disabled={saving} sx={{mt:1}} onClick={()=>{setTemplateName("");setTemplateDialog(true);}}>Save as template</Button>
            </>:null}
            {entry.kind!=="column"?<Button ref={selectedControl} size="small" color="error" disabled={saving} sx={{mt:2}} onClick={removeSelected}>Remove {entry.label}</Button>:null}
          </>:<Box sx={{py:3,px:1}}>
            <Box sx={{width:48,height:48,mx:"auto",mb:2,borderRadius:3,bgcolor:"#edf4fc",display:"grid",placeItems:"center",color:"#2273b9"}}><WidgetsOutlined/></Box>
            <Typography variant="subtitle2" sx={{mb:1}}>Select a component</Typography>
            <Typography variant="body2" color="text.secondary">Choose a widget on the canvas or in Structure to edit its content and appearance.</Typography>
            <Divider sx={{my:3}}/>
            <Typography variant="subtitle2" sx={{mb:2}}>Page settings</Typography>
            <TextField select fullWidth size="small" label="Page title" value={layout.settings?.show_title===false?"hidden":"visible"} disabled={saving}
              onChange={event=>change({...layout,settings:{...layout.settings,show_title:event.target.value==="visible"}})}>
              <MenuItem value="visible">Show title</MenuItem><MenuItem value="hidden">Hide title visually</MenuItem>
            </TextField>
            <TextField select fullWidth size="small" sx={{mt:2}} label="Content width" value={layout.settings?.content_width??"full"} disabled={saving}
              onChange={event=>change({...layout,settings:{...layout.settings,content_width:event.target.value as "full"|"wide"|"reading"}})}>
              <MenuItem value="full">Full width</MenuItem><MenuItem value="wide">Wide · 1280px</MenuItem><MenuItem value="reading">Reading · 880px</MenuItem>
            </TextField>
          </Box>}
          {Object.keys(errors).length?<Box role="alert" sx={{mt:2}}><Typography color="error">Check these fields before saving:</Typography>{Object.entries(errors).slice(0,12).map(([path,messages])=><Typography key={path} variant="caption" component="p" sx={{overflowWrap:"anywhere"}}>{path}: {messages.join(" ")}</Typography>)}</Box>:null}
        </Paper>:null}
      </Box>
    </>}
    <Dialog open={templateDialog} onClose={()=>{if(!saving)setTemplateDialog(false);}} fullWidth maxWidth="xs">
      <DialogTitle>Save section as template</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{mb:2}}>Stores this Site-owned section (columns, widgets and repeater order). Inserts later clone new node IDs and re-check media.</Typography>
        <TextField autoFocus fullWidth label="Template name" value={templateName} onChange={event=>setTemplateName(event.target.value)} inputProps={{maxLength:120}}/>
      </DialogContent>
      <DialogActions>
        <Button onClick={()=>setTemplateDialog(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" disabled={saving || !templateName.trim()} onClick={()=>void saveSelectedAsTemplate()}>{saving?"Saving…":"Save template"}</Button>
      </DialogActions>
    </Dialog>
    <WidgetPicker open={!!picker && !media} context={`${siteName} · ${page.title} · ${contextLabel}`} nested={!!picker?.widgetId} onChoose={type=>insert(type)} onClose={()=>setPicker(null)} returnFocus={()=>invoker.current?.focus()}/>
    {media?<MediaPickerDialog open siteId={siteId} canUpload={permissions.includes("content.media.upload")} returnFocusRef={mediaInvoker} onCancel={()=>setMedia(null)} onConfirm={result=>{if(media.type)insert(media.type,result);else{media.apply?.(result);setMedia(null);}}}/>:null}
    <ContentWorkflowDialog
      noun="Page"
      action={pendingWorkflow?.action??null}
      title={page.title}
      comment={workflowComment}
      error={workflowError}
      busy={workflowBusy}
      onComment={setWorkflowComment}
      onClose={()=>{if(!workflowBusy){setPendingWorkflow(null);setWorkflowPreview(null);setWorkflowError("");}}}
      onConfirm={()=>void confirmWorkflow()}
    >
      {workflowPreview ? (
        <Box>
          <Typography variant="overline">Private revision {workflowPreview.revision_number}</Typography>
          <PublicPageView
            page={pageFromResponse(200, workflowPreview.page)}
            privateMediaBase={`${APP_BASE_PATH}/sites/${siteId}/pages/${page.id}/preview-media/${workflowPreview.revision_number}`}
          />
        </Box>
      ) : null}
    </ContentWorkflowDialog>
  </Box>;
}

function WidgetPicker({open,context,nested,onChoose,onClose,returnFocus}:{open:boolean;context:string;nested:boolean;onChoose:(type:WidgetType)=>void;onClose:()=>void;returnFocus:()=>void}) {
  const [query,setQuery]=useState("");const [category,setCategory]=useState("All");
  useEffect(()=>{if(open){setQuery("");setCategory("All");}},[open]);
  const matching=registry.filter(value=>(!nested || ["hero_image","headline","editor","image","button"].includes(value.type)) && `${value.label} ${value.type}`.toLowerCase().includes(query.toLowerCase().trim()));
  const visible=matching.filter(value=>category==="All" || categories.find(item=>item.label===category)?.types.includes(value.type));
  function arrow(event:KeyboardEvent<HTMLDivElement>) {
    if(!(event.target as HTMLElement).hasAttribute("data-widget-card"))return;
    const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-widget-card]"));
    const current=buttons.indexOf(event.target as HTMLButtonElement);let next=current;
    if(event.key==="ArrowRight" || event.key==="ArrowDown")next=(current+1)%buttons.length;
    else if(event.key==="ArrowLeft" || event.key==="ArrowUp")next=(current-1+buttons.length)%buttons.length;
    else if(event.key==="Home")next=0;else if(event.key==="End")next=buttons.length-1;else return;
    event.preventDefault();buttons[next]?.focus();
  }
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" TransitionProps={{onExited:returnFocus}}>
    <DialogTitle>Choose a widget<Typography variant="body2" color="text.secondary">Insert into {context}. {nested?"This layout item accepts Hero Image, Headline, Editor, Image and Button.":"Choose from the approved 43-widget catalog."}</Typography></DialogTitle>
    <DialogContent>
      <TextField autoFocus fullWidth label="Search widgets" placeholder="Try Slider, Image or Button" value={query} onChange={event=>setQuery(event.target.value)} sx={{mt:1,mb:2}}/>
      <Box aria-label="Widget categories" sx={{display:"flex",gap:1,flexWrap:"wrap",mb:2}}>
        <Button size="small" variant={category==="All"?"contained":"outlined"} aria-pressed={category==="All"} onClick={()=>setCategory("All")}>All ({matching.length})</Button>
        {categories.map(item=>{const count=matching.filter(value=>item.types.includes(value.type)).length;return <Button key={item.label} size="small" disabled={!count} variant={category===item.label?"contained":"outlined"} aria-pressed={category===item.label} onClick={()=>setCategory(item.label)}>{item.label} ({count})</Button>;})}
      </Box>
      <Typography role="status" variant="caption" component="p" sx={{mb:1}}>{visible.length} widgets match</Typography>
      {visible.length?<Box onKeyDown={arrow} sx={{display:"grid",gridTemplateColumns:{xs:"1fr",sm:"repeat(2,minmax(0,1fr))",md:"repeat(3,minmax(0,1fr))"},gap:1.5}}>
        {visible.map(value=><Button data-widget-card key={value.type} variant="outlined" onClick={()=>onChoose(value.type)} sx={{p:2,minHeight:100,textTransform:"none",alignItems:"flex-start",flexDirection:"column",gap:1,borderRadius:2,textAlign:"left",borderColor:"divider","&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}}}>
          <WidgetIcon type={value.type}/><Typography fontWeight={700}>{value.label}</Typography><Typography variant="caption" color="text.secondary">{categories.find(item=>item.types.includes(value.type))?.label}</Typography>
        </Button>)}
      </Box>:<Alert severity="info">No widgets match your search. <Button onClick={()=>{setQuery("");setCategory("All");}}>Clear search</Button></Alert>}
    </DialogContent>
    <DialogActions><Typography variant="caption" sx={{mr:"auto",pl:2}}>Tab or arrow keys to browse · Enter to insert · Escape to close</Typography><Button onClick={onClose}>Cancel</Button></DialogActions>
  </Dialog>;
}
