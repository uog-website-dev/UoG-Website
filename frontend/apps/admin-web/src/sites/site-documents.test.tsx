import {beforeEach,describe,expect,it,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {SiteDocuments} from "./site-documents";
import type {SiteDocument} from "@/app/sites/document-actions";

let docs:SiteDocument[]=[];
let permissions:string[]=[];
const saved=vi.fn();
vi.mock("@/sites/site-admin-frame",()=>({useSiteAdmin:()=>({site:{id:17},permissions})}));
vi.mock("@/data/query-cache",()=>({useSiteQuery:(_site:number,key:string,params:{id?:string})=>({data:key==="documents"?{count:docs.length,next:null,previous:null,results:docs}:key==="document-detail"?docs.find(row=>row.id===params.id)??null:key==="document-categories"?[]:null,error:null,isLoading:false,setData:()=>{}})}));
vi.mock("@/organizations/contract",()=>({unwrap:(result:{ok:boolean;data?:unknown;error?:unknown})=>{if(!result.ok)throw result.error;return result.data}}));
vi.mock("@/app/sites/document-actions",()=>({
 listSiteDocuments:async()=>({ok:true,data:{count:docs.length,next:null,previous:null,results:docs}}),
 getSiteDocument:async(_site:number,id:string)=>({ok:true,data:docs.find(row=>row.id===id)}),
 getSiteDocumentCategories:async()=>({ok:true,data:[]}),
 createSiteDocumentCategory:async()=>({ok:true,data:{id:"cat-1",name:"Policies",slug:"policies"}}),
 saveSiteDocument:async(_site:number,input:Partial<SiteDocument>,id?:string)=>{saved(input,id);if(id){docs=docs.map(row=>row.id===id?{...row,...input,updated_at:new Date().toISOString()}:row);return{ok:true,data:docs.find(row=>row.id===id)}}const row:SiteDocument={id:"doc-1",site:17,title:input.title??"",slug:"annual-report",description:input.description??"",file_reference:input.file_reference??"",file_type:"application/pdf",original_filename:"policy.pdf",file_size:128,status:"DRAFT",creator:1,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",revision_number:1,published_at:null,version:input.version??"",effective_date:null,visibility:"PUBLIC",visible_to_public:input.visible_to_public??true,require_login_to_download:input.require_login_to_download??false,categories:[]};docs=[row];return{ok:true,data:row}},
 documentWorkflow:async()=>({ok:true,data:docs[0]}),deleteSiteDocument:async()=>({ok:true,data:null}),
}));
vi.mock("@/sites/media-library",()=>({MediaLibrary:({onSelect}:{onSelect:(asset:{id:string;original_filename:string;byte_count:number})=>void})=><button onClick={()=>onSelect({id:"asset-1",original_filename:"policy.pdf",byte_count:128})}>Select policy.pdf</button>}));
vi.mock("@/sites/post-rich-editor",()=>({PostRichEditor:({value,onChange}:{value:string;onChange:(value:string)=>void})=><textarea aria-label="Document Description" value={value} onChange={e=>onChange(e.target.value)}/> }));
vi.mock("@uog/ui",()=>({
 DataTable:({rows,columns,renderActions}:{rows:SiteDocument[];columns:{field:string;render:(row:SiteDocument)=>React.ReactNode}[];renderActions:(row:SiteDocument)=>React.ReactNode})=><div>{rows.map(row=><div key={row.id}>{columns.map(column=><span key={column.field}>{column.render(row)}</span>)}{renderActions(row)}</div>)}</div>,
 FilterBar:({children,label,onApply,onReset}:{children:React.ReactNode;label:string;onApply:()=>void;onReset:()=>void})=><div role="search" aria-label={label}>{children}<button onClick={onApply}>Apply</button><button onClick={onReset}>Reset</button></div>,TextFilter:({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void})=><input aria-label={label} value={value} onChange={e=>onChange(e.target.value)}/>,SelectFilter:({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:{value:string;label:string}[]})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>,Pagination:({page,onPageChange}:{page:number;onPageChange:(page:number)=>void})=><button onClick={()=>onPageChange(page+1)}>Next page</button>,useToast:()=>({success:vi.fn(),error:vi.fn()}),
}));
vi.mock("next/link",()=>({default:({href,children,...props}:{href:string;children:React.ReactNode})=><a href={href} {...props}>{children}</a>}));

describe("Site Documents authoring",()=>{
 beforeEach(()=>{docs=[];permissions=["content.documents.view","content.documents.create","content.documents.update","content.documents.publish","content.documents.delete"];saved.mockClear()});
 it("creates a draft from the full form, lists it, and edits the same record",async()=>{
  const user=userEvent.setup();render(<SiteDocuments/>);
  await user.click(screen.getByRole("button",{name:"Add New Document"}));
  expect(screen.getByRole("heading",{name:"Add New Document"})).toBeTruthy();
  await user.type(screen.getByRole("textbox",{name:"Document Title"}),"Annual report");
  await user.click(screen.getByRole("button",{name:"Choose or upload a document"}));
  await user.click(screen.getByRole("button",{name:"Select policy.pdf"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  await user.type(screen.getByRole("textbox",{name:"Document Description"}),"Published annual details");
  await user.click(screen.getByRole("button",{name:"Save as Draft"}));
  await waitFor(()=>expect(saved).toHaveBeenCalledWith(expect.objectContaining({title:"Annual report",file_reference:"sites/17/assets/asset-1",description:"Published annual details"}),undefined));
  expect(await screen.findByText("Annual report")).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Edit"}));
  expect(await screen.findByRole("heading",{name:"Edit Document"})).toBeTruthy();
  const title=screen.getByRole("textbox",{name:"Document Title"});await user.clear(title);await user.type(title,"Annual report revised");
  await user.click(screen.getByRole("button",{name:"Save as Draft"}));
  await waitFor(()=>expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({title:"Annual report revised"}),"doc-1"));
  expect(await screen.findByText("Annual report revised")).toBeTruthy();
 });
 it("hides document creation and editing controls without management permission",async()=>{
  permissions=["content.documents.view"];
  docs=[{id:"view-only",site:17,title:"Read-only policy",slug:"policy",description:"",file_reference:"sites/17/assets/file",file_type:"application/pdf",original_filename:"policy.pdf",file_size:10,categories:[],status:"DRAFT",creator:1,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",revision_number:1,published_at:null,version:"1",effective_date:null,visibility:"PUBLIC",visible_to_public:true,require_login_to_download:false}];
  render(<SiteDocuments/>);
  expect(screen.queryByRole("button",{name:"Add New Document"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Edit"})).toBeNull();
 });
 it("does not expose document preview without the document view permission",()=>{
  permissions=["content.documents.create"];
  docs=[{id:"no-view",site:17,title:"Restricted policy",slug:"restricted",description:"",file_reference:"sites/17/assets/file",file_type:"application/pdf",original_filename:"policy.pdf",file_size:10,categories:[],status:"DRAFT",creator:1,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",revision_number:1,published_at:null,version:"1",effective_date:null,visibility:"HIDDEN",visible_to_public:false,require_login_to_download:true}];
  render(<SiteDocuments/>);
  expect(screen.queryByRole("link",{name:"Preview"})).toBeNull();
 });
 it("hides publish controls from a view-only user",()=>{
  permissions=["content.documents.view"];
  docs=[{id:"published-view-only",site:17,title:"Published policy",slug:"published",description:"",file_reference:"sites/17/assets/file",file_type:"application/pdf",original_filename:"policy.pdf",file_size:10,categories:[],status:"PUBLISHED",creator:1,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",revision_number:1,published_at:"2026-01-01T00:00:00Z",version:"1",effective_date:null,visibility:"PUBLIC",visible_to_public:true,require_login_to_download:false}];
  render(<SiteDocuments/>);
  expect(screen.queryByRole("button",{name:"Unpublish"})).toBeNull();
  expect(screen.getByRole("link",{name:"Preview"})).toBeTruthy();
 });
});
