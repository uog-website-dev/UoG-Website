"use client";
import {Profiler,type ReactNode,type ProfilerOnRenderCallback} from "react";

interface RenderSample {id:string;phase:string;actual_ms:number;base_ms:number;commit_ms:number}
declare global {interface Window {__uogRenderProfiles?:RenderSample[]}}
const record:ProfilerOnRenderCallback=(id,phase,actual,base,_start,commit)=>{
  if(typeof window==="undefined")return;
  const rows=window.__uogRenderProfiles??(window.__uogRenderProfiles=[]);
  rows.push({id,phase,actual_ms:actual,base_ms:base,commit_ms:commit});
  if(rows.length>500)rows.splice(0,rows.length-500);
};
/** Diagnostic builds only: never records props, content, user IDs or tokens. */
export function RenderProbe({id,children}:{id:string;children:ReactNode}) {
  if(process.env.NEXT_PUBLIC_RENDER_PROFILING!=="1")return children;
  return <Profiler id={id} onRender={record}>{children}</Profiler>;
}
