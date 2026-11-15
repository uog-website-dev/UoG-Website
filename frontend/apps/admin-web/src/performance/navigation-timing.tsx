"use client";
import {useEffect} from "react";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY="uog:performance:active-navigation";
/** Only mounted when the server explicitly enables measurement. No auth data is stored. */
export function NavigationTiming(){
 useEffect(()=>{
  const original=window.fetch.bind(window);let current:string|null=null;let target:string|null=null;
  const restore=()=>{try{const value=JSON.parse(sessionStorage.getItem(KEY)??"null");if(value&&UUID.test(value.id)&&typeof value.epoch_ms==='number'&&Date.now()-value.epoch_ms<120000){current=value.id;target=typeof value.target==="string"?value.target:null;
   if(!performance.getEntriesByName(`uog:navigation:${current}:start`).length)performance.mark(`uog:navigation:${current}:start`,{startTime:0,detail:{scope:"resumed-document",original_start_epoch_ms:value.epoch_ms}});
  }}catch{}};
  restore();
  const start=(event:Event)=>{const detail=(event as CustomEvent<{id?:string;target?:string}>).detail;target=detail?.target??null;current=detail?.id&&UUID.test(detail.id)?detail.id:crypto.randomUUID();const epoch_ms=Date.now();
   try{sessionStorage.setItem(KEY,JSON.stringify({id:current,epoch_ms,target}));}catch{}
   performance.mark(`uog:navigation:${current}:start`,{detail:{scope:"current-document",original_start_epoch_ms:epoch_ms}});
  };
  const finish=(event:Event)=>{const supplied=(event as CustomEvent<{id?:string}>).detail?.id;if(!current)restore();const id=supplied&&UUID.test(supplied)?supplied:current;
   if(id){const beginning=performance.getEntriesByName(`uog:navigation:${id}:start`).at(-1) as PerformanceMark|undefined;
    if(beginning){performance.mark(`uog:navigation:${id}:usable`);performance.measure(`uog:navigation:${id}`,{start:`uog:navigation:${id}:start`,end:`uog:navigation:${id}:usable`,detail:beginning.detail});}
    try{sessionStorage.removeItem(KEY);}catch{}current=null;target=null;
   }
  };
  const click=(event:MouseEvent)=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const anchor=(event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement|null;if(anchor&&anchor.origin===location.origin&&anchor.pathname.startsWith("/admin/")&&!current)start(new CustomEvent("navigation",{detail:{target:anchor.pathname}}));};
  const change=(event:Event)=>{const select=event.target as HTMLSelectElement;if(select?.matches?.("select")&&!current&&/^site:[0-9]+$/.test(select.value))start(new CustomEvent("navigation",{detail:{target:`/admin/sites/${select.value.slice(5)}/admin`}}));};
  const request=(event:Event)=>{if(!current)start(event);};
  const checkReady=()=>{
   if(!current||!target||location.pathname.replace(/\/$/,"")!==target.replace(/\/$/,""))return;
   const expected=/^\/admin\/sites\/([0-9]+)\/admin(?:\/(pages|posts|menus))?\/?$/.exec(target);
   if(!expected)return;
   const scope=document.querySelector(`[data-perf-site-id="${expected[1]}"]`),content=scope?.querySelector(`[data-perf-section="${expected[2]??"dashboard"}"]`);
   const readyNavigation=[...document.querySelectorAll('[data-perf-navigation-ready="true"]')].some(node=>node.getBoundingClientRect().width>0);
   if(content&&readyNavigation&&content.getAttribute("data-perf-pending")!=="true"&&!scope?.querySelector('[data-perf-pending="true"],[data-perf-error="true"],.MuiSkeleton-root,.MuiAlert-standardError'))finish(new Event("navigation"));
  };
  const observer=new MutationObserver(checkReady);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["data-perf-pending","data-perf-navigation-ready","data-perf-site-id","data-perf-section","data-perf-error"]});
  checkReady();
  window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);if(current&&url.origin===location.origin&&url.pathname.startsWith("/admin")&&!url.pathname.includes("/api/auth")){
   const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init?.headers).forEach((v,k)=>headers.set(k,v));headers.set("X-Navigation-ID",current);if(!headers.has("X-Request-ID"))headers.set("X-Request-ID",crypto.randomUUID());return original(input,{...init,headers});}return original(input,init);};
  window.addEventListener("uog:navigation:request",request);window.addEventListener("uog:navigation:start",start);window.addEventListener("uog:navigation:usable",finish);document.addEventListener("click",click,true);document.addEventListener("change",change,true);
  return()=>{observer.disconnect();window.fetch=original;window.removeEventListener("uog:navigation:request",request);window.removeEventListener("uog:navigation:start",start);window.removeEventListener("uog:navigation:usable",finish);document.removeEventListener("click",click,true);document.removeEventListener("change",change,true);};
 },[]);return null;
}
