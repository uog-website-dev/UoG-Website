import {describe,expect,it} from "vitest";
import {historyShortcut,isEditableKeyboardTarget,pushHistory,VISUAL_HISTORY_LIMIT} from "./visual-builder-history";
import type {VisualLayout} from "@uog/types";

const layout=(id:string):VisualLayout=>({schema_version:1,rows:[{id,type:"section",ratios:[100],columns:[{id:`${id}-col`,type:"column",children:[]}]}]});

describe("visual builder local history helpers",()=>{
  it("bounds the undo stack and preserves the newest entries",()=>{
    let past:{layout:VisualLayout;selected:string|null}[]=[];
    for(let i=0;i<VISUAL_HISTORY_LIMIT+5;i+=1){
      past=pushHistory(past,{layout:layout(`row-${i}`),selected:`row-${i}`});
    }
    expect(past).toHaveLength(VISUAL_HISTORY_LIMIT);
    expect(past[0]!.selected).toBe("row-5");
    expect(past.at(-1)!.selected).toBe(`row-${VISUAL_HISTORY_LIMIT+4}`);
  });

  it("routes Ctrl/Cmd+Z and Ctrl/Cmd+Y/Shift+Z outside text fields only",()=>{
    const input=document.createElement("input");
    document.body.append(input);
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(historyShortcut({key:"z",ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,target:input})).toBeNull();
    expect(historyShortcut({key:"z",ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,target:document.body})).toBe("undo");
    expect(historyShortcut({key:"y",ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,target:document.body})).toBe("redo");
    expect(historyShortcut({key:"z",ctrlKey:true,metaKey:false,shiftKey:true,altKey:false,target:document.body})).toBe("redo");
    expect(historyShortcut({key:"z",ctrlKey:false,metaKey:true,shiftKey:false,altKey:false,target:document.body})).toBe("undo");
    input.remove();
  });
});
