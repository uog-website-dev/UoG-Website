import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { updateSiteMedia }=vi.hoisted(()=>({updateSiteMedia:vi.fn()}));
vi.mock("@/app/sites/media-actions",()=>({updateSiteMedia}));
import { MediaUploadPanel } from "./media-upload-panel";
const policy={image_max_bytes:20971520,pdf_max_bytes:20971520,text_max_bytes:5242880,mime_types:["image/png","image/jpeg","image/webp","application/pdf","text/plain"]};
const asset=(id:string,site=11)=>({id,site,display_name:"Campus",categories:[],original_filename:`${id}.png`,detected_mime:"image/png",content_type:"image/png",alt_text:"",status:"PENDING",processing_state:"PROCESSING"});
function Harness({siteId=11,accept=vi.fn()}:{siteId?:number;accept?:(value:any)=>void}) {const ref=useRef<HTMLInputElement|null>(null);return <MediaUploadPanel key={siteId} siteId={siteId} policy={policy} inputRef={ref} onAccepted={accept} />;}
const choose=(files:File[])=>fireEvent.change(screen.getByLabelText("Upload media file"),{target:{files}});
beforeEach(()=>{vi.clearAllMocks();updateSiteMedia.mockImplementation(async(site:number,id:string,change:unknown)=>({ok:true,data:{...asset(id,site),...change as object}}));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Media upload queue",()=>{
 it("drops multiple files and persists each file's name, categories and alt text",async()=>{
  const send=vi.spyOn(globalThis,"fetch");
  send.mockImplementation(async(input)=>new Response(JSON.stringify(asset(String(input).includes("first.png")?"one":"two")),{status:202}));
  const accept=vi.fn();render(<Harness accept={accept}/>);
  fireEvent.drop(screen.getByRole("button",{name:"Drop files to upload or browse"}),{dataTransfer:{files:[new File(["first"],"first.png",{type:"image/png"}),new File(["second"],"second.png",{type:"image/png"})]}});
  fireEvent.change(screen.getByLabelText("Media name for first.png"),{target:{value:"Campus festival"}});
  fireEvent.change(screen.getByLabelText("Categories for first.png"),{target:{value:"Campus, Events"}});
  fireEvent.change(screen.getByLabelText("Alt text for first.png"),{target:{value:"Students at the festival"}});
  fireEvent.click(screen.getByRole("button",{name:"Upload 2 files"}));
  await screen.findByText(/Upload finished/);
  expect(updateSiteMedia).toHaveBeenCalledWith(11,"one",{display_name:"Campus festival",categories:["Campus","Events"],alt_text:"Students at the festival"});
  expect(updateSiteMedia).toHaveBeenCalledWith(11,"two",{display_name:"second",categories:[],alt_text:""});
  expect(send).toHaveBeenCalledTimes(2);
  const keys=send.mock.calls.map(call=>(call[1]?.headers as Record<string,string>)["Idempotency-Key"]);
  expect(new Set(keys).size).toBe(2);
  expect(accept).toHaveBeenCalled();
  expect(screen.queryByRole("list",{name:"Upload queue"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Upload 0 files"})).toBeNull();
 });

 it("retries metadata without resending stored bytes",async()=>{
  const send=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(asset("one")),{status:202}));
  updateSiteMedia.mockResolvedValueOnce({ok:false,error:{status:503,message:"Unavailable"}});
  render(<Harness/>);choose([new File(["image"],"first.png",{type:"image/png"})]);
  fireEvent.click(screen.getByRole("button",{name:"Upload 1 file"}));
  await screen.findByText(/File uploaded, but metadata could not be saved/);
  fireEvent.click(screen.getByRole("button",{name:"Retry metadata"}));
  await screen.findByText(/Upload finished/);
  expect(send).toHaveBeenCalledTimes(1);expect(updateSiteMedia).toHaveBeenCalledTimes(2);
 });

 it("rejects oversized and unsupported files before sending and keeps valid peers",async()=>{
  const send=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(asset("ok")),{status:202}));
  render(<Harness/>);
  const large=new File(["bytes"],"large.png",{type:"image/png"});Object.defineProperty(large,"size",{value:20971521});
  choose([large,new File(["executable"],"unsafe.exe",{type:"application/x-msdownload"}),new File(["image"],"good.png",{type:"image/png"})]);
  fireEvent.click(screen.getByRole("button",{name:"Upload 3 files"}));
  await screen.findByText(/Upload finished/);
  expect(await screen.findByText(/exceeds its/)).toBeTruthy();
  expect(screen.getByText(/Unsupported file type/)).toBeTruthy();
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listitem",{name:"Upload good.png"})).toBeNull();
  expect(screen.getByRole("listitem",{name:"Upload large.png"})).toBeTruthy();
 });

 it("bounds concurrent uploads to two and aborts pending requests on Site change",async()=>{
  const requests:{signal:AbortSignal;resolve:(value:Response)=>void}[]=[];
  const send=vi.spyOn(globalThis,"fetch").mockImplementation((_url,init)=>new Promise(resolve=>{requests.push({signal:init!.signal as AbortSignal,resolve});}));
  const accept=vi.fn();const view=render(<Harness accept={accept}/>);
  choose([1,2,3].map(i=>new File(["image"],`file${i}.png`,{type:"image/png"})));
  fireEvent.click(screen.getByRole("button",{name:"Upload 3 files"}));
  await waitFor(()=>expect(send).toHaveBeenCalledTimes(2));
  view.rerender(<Harness siteId={22} accept={accept}/>);
  expect(requests.every(r=>r.signal.aborted)).toBe(true);
  await act(async()=>{for(const request of requests)request.resolve(new Response(JSON.stringify(asset("old")),{status:202}));});
  expect(accept).not.toHaveBeenCalled();expect(updateSiteMedia).not.toHaveBeenCalled();
  expect(screen.queryByRole("list",{name:"Upload queue"})).toBeNull();
 });
});

it("releases local preview URLs and replaces unreadable local images with a safe placeholder", async()=>{
 const OriginalURL=URL; const create=vi.fn(()=>"blob:media-preview"); const revoke=vi.fn();
 vi.stubGlobal("URL",class extends OriginalURL {static createObjectURL=create;static revokeObjectURL=revoke;});
 const view=render(<Harness/>);choose([new File(["image"],"preview.png",{type:"image/png"})]);
 const preview=await screen.findByRole("img",{name:"Selected preview.png"});
 expect(preview.getAttribute("src")).toBe("blob:media-preview");
 fireEvent.error(preview);expect(screen.queryByRole("img",{name:"Selected preview.png"})).toBeNull();
 view.unmount();expect(revoke).toHaveBeenCalledWith("blob:media-preview");
});
