import type { VisualLayout, WidgetNode } from "./generated";

/** Explicit import adapter. Reading a legacy Page never rewrites its payload. */
export function adaptLegacyBlocks(blocks: readonly Record<string, unknown>[]): VisualLayout {
  const reserved=new Set<string>();
  const collect=(nodes:readonly Record<string,unknown>[])=>{for(const node of nodes){if(typeof node.id === "string")reserved.add(node.id);if(Array.isArray(node.children))collect(node.children);}};
  collect(blocks);
  const issued=new Set<string>();
  const id=(hint:string, original?:unknown)=>{
    if(typeof original === "string" && !issued.has(original)){issued.add(original);return original;}
    let result=`legacy:${hint}`;while(reserved.has(result)||issued.has(result))result += ":copy";issued.add(result);return result;
  };
  const rows:VisualLayout["rows"]=[];
  const visit=(nodes:readonly Record<string,unknown>[],prefix:string)=>nodes.forEach((block,index)=>{
    const path=`${prefix}.${index}`;
    if(block.type === "section" && Array.isArray(block.children)){
      if(typeof block.heading === "string")visit([{type:"heading",text:block.heading,level:2}],`${path}.heading`);
      visit(block.children,`${path}.children`);return;
    }
    const nodeId=id(`${path}.widget`,block.id);
    let widget:WidgetNode;
    if(block.type === "heading")widget={id:nodeId,type:"headline",props:{text:String(block.text ?? ""),level:block.level === 3 || block.level === 4 ? block.level : 2}};
    else if(block.type === "paragraph")widget={id:nodeId,type:"editor",props:{html:String(block.html ?? "")}};
    else if(block.type === "button")widget={id:nodeId,type:"button",props:{label:String(block.label ?? ""),href:String(block.href ?? "")}};
    else if(block.type === "image"){
      const match=/^sites\/[0-9]+\/assets\/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(String(block.ref ?? ""));
      if(!match)throw new Error(`Legacy image at ${path} needs a canonical Media asset before visual-layout import.`);
      widget={id:nodeId,type:"image",props:{asset_id:match[1]!.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/,"$1-$2-$3-$4-$5"),alt:String(block.alt ?? "")}};
    } else if(block.type === "slider" || block.type === "gallery"){
      const values=block[block.type === "slider" ? "slides" : "images"];
      if(!Array.isArray(values))throw new Error(`Invalid legacy media at ${path}.`);
      widget={id:nodeId,type:block.type === "slider"?"image_slider":"image_grid",props:{items:values.map(item=>({id:item.id,asset_id:item.asset_id,alt:item.alt,caption:item.caption || item.alt || "Image"}))}};
    } else if(block.type === "list" && Array.isArray(block.items)){
      widget={id:nodeId,type:"editor",props:{html:block.items.map(item=>`<p>${String(item).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`).join("")}};
    } else throw new Error(`Unsupported legacy block at ${path}.`);
    let row=rows[rows.length-1];
    if(!row || row.columns[0]!.children.length >= 50) {
      row={id:id(`${path}.row`),type:"section",ratios:[100],columns:[{id:id(`${path}.column`),type:"column",children:[]}]};
      rows.push(row);
    }
    row.columns[0]!.children.push(widget);
  });
  visit(blocks,"blocks");return {schema_version:1,rows};
}
