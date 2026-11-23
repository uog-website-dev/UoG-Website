import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,it,expect,vi} from "vitest";
const load=vi.fn(),prepare=vi.fn(),apply=vi.fn(),pages=vi.fn(),getPage=vi.fn();
vi.mock("@/app/sites/homepage-template-actions",()=>({loadHomepageTemplates:(...args:unknown[])=>load(...args),prepareHomepageTemplate:(...args:unknown[])=>prepare(...args),applyHomepageTemplate:(...args:unknown[])=>apply(...args)}));
vi.mock("@/app/sites/page-actions",()=>({loadSitePages:(...args:unknown[])=>pages(...args),getSitePage:(...args:unknown[])=>getPage(...args)}));
import {HomepageTemplateCatalogue} from "./homepage-template-catalogue";
const layout={schema_version:1 as const,rows:[]};
const entries=['University Main','College/Department','Blank'].map((name,i)=>({manifest_version:1,id:['university-main','college-department','blank'][i],version:1,name,description:'Approved starting design '+name,required_modules:['PAGES','VISUAL_BUILDER'],layout,available:true,unavailable_reasons:[]}));
beforeEach(()=>{vi.clearAllMocks();load.mockResolvedValue({ok:true,data:entries});prepare.mockResolvedValue({ok:true,data:layout});pages.mockResolvedValue({ok:true,data:{results:[]}});getPage.mockResolvedValue({ok:true,data:{id:"draft-1",site:11,etag:'"cms-content-draft-1-r2"'}});apply.mockResolvedValue({ok:true,data:{id:"draft-1"}});});
it('browses three templates and responsive non-mutating previews with keyboard focus',async()=>{
 render(<HomepageTemplateCatalogue siteId={11} canEdit/>);
 const button=await screen.findByRole('button',{name:'Preview University Main'});button.focus();expect(document.activeElement).toBe(button);fireEvent.click(button);
 expect(await screen.findByLabelText('University Main template preview')).toBeTruthy();expect(screen.getByText('Your blank canvas')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Mobile'}));expect(screen.getByRole('button',{name:'Mobile'}).getAttribute('aria-pressed')).toBe('true');
 expect(prepare).not.toHaveBeenCalled();expect(load).toHaveBeenCalledWith(11);
});
it('requires explicit selection and confirmation and returns a prepared unsaved document',async()=>{
 const choose=vi.fn();render(<HomepageTemplateCatalogue siteId={11} canEdit onChoose={choose}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Preview Blank'}));fireEvent.click(screen.getByRole('button',{name:'Use Blank in this draft'}));
 expect(prepare).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm template selection'}));
 await waitFor(()=>expect(choose).toHaveBeenCalledWith(layout,'Blank'));expect(prepare).toHaveBeenCalledWith(11,'blank',1);
});
it('shows unavailable reasons and never enables incompatible template selection',async()=>{
 load.mockResolvedValue({ok:true,data:[{...entries[0],available:false,layout:null,unavailable_reasons:['Unsupported schema version.']}]});
 render(<HomepageTemplateCatalogue siteId={11} canEdit/>);expect(await screen.findByText('Unsupported schema version.')).toBeTruthy();expect((screen.getByRole('button',{name:'Preview University Main'}) as HTMLButtonElement).disabled).toBe(true);
});
it('blocks unauthorized users before fetching',()=>{
 render(<HomepageTemplateCatalogue siteId={11} canEdit={false}/>);expect(screen.getByText(/editing permission is required/)).toBeTruthy();expect(load).not.toHaveBeenCalled();
});
it('clears former Site data and ignores stale responses',async()=>{
 let finish:(value:unknown)=>void=()=>{};load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<HomepageTemplateCatalogue siteId={11} canEdit/>);view.rerender(<HomepageTemplateCatalogue siteId={22} canEdit/>);
 await screen.findByRole('button',{name:'Preview Blank'});finish({ok:true,data:[{...entries[0],name:'Old Site template'}]});
 await waitFor(()=>expect(screen.queryByText('Old Site template')).toBeNull());expect(load).toHaveBeenLastCalledWith(22);
});
it('keeps the canvas unchanged on prepare failure and supports retry',async()=>{
 prepare.mockResolvedValue({ok:false,error:{message:'Access revoked'}});const choose=vi.fn();render(<HomepageTemplateCatalogue siteId={11} canEdit onChoose={choose}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Preview Blank'}));fireEvent.click(screen.getByRole('button',{name:'Use Blank in this draft'}));fireEvent.click(screen.getByRole('button',{name:'Confirm template selection'}));
 expect(await screen.findByText('Access revoked')).toBeTruthy();expect(choose).not.toHaveBeenCalled();expect(screen.getByLabelText('Blank template preview')).toBeTruthy();
});
it('loads a real approved layout through the shared renderer',async()=>{
 const manifest={layout:{schema_version:1,rows:[{id:'row',type:'section',ratios:[100],columns:[{id:'column',type:'column',children:[{id:'heading',type:'headline',props:{text:'Learning that transforms lives',level:2}}]}]}]}};
 load.mockResolvedValue({ok:true,data:[{...entries[0],layout:manifest.layout}]});render(<HomepageTemplateCatalogue siteId={11} canEdit/>);
 fireEvent.click(await screen.findByRole('button',{name:'Preview University Main'}));expect(await screen.findByRole('heading',{name:'Learning that transforms lives'})).toBeTruthy();
});
it('requires confirmation before applying a template as a new Page draft and opens the result',async()=>{
 const opened=vi.fn();render(<HomepageTemplateCatalogue siteId={11} canEdit onApplied={opened}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Preview University Main'}));
 fireEvent.click(screen.getByRole('button',{name:'Apply University Main as draft'}));
 expect(screen.getByText(/published homepage will remain unchanged/i)).toBeTruthy();
 fireEvent.change(screen.getByRole('textbox',{name:'Draft title'}),{target:{value:'A new homepage'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirm and open draft'}));
 await waitFor(()=>expect(apply).toHaveBeenCalledWith(11,{template_id:'university-main',version:1,mode:'new',title:'A new homepage'},expect.any(String),undefined));
 expect(opened).toHaveBeenCalledWith({id:'draft-1'});
});
it('fetches a fresh revision tag before replacing an existing draft',async()=>{
 pages.mockImplementation((_site:number,query:{status:string})=>Promise.resolve({ok:true,data:{results:query.status==="DRAFT"?[{id:"draft-1",site:11,title:"Existing draft",is_homepage:false}]:[]}}));
 const opened=vi.fn();render(<HomepageTemplateCatalogue siteId={11} canEdit onApplied={opened}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Preview College/Department'}));fireEvent.click(screen.getByRole('button',{name:'Apply College/Department as draft'}));
 fireEvent.mouseDown(screen.getByRole('combobox',{name:'Draft action'}));fireEvent.click(await screen.findByRole('option',{name:'Replace an existing draft'}));
 fireEvent.mouseDown(screen.getByRole('combobox',{name:'Draft to replace'}));fireEvent.click((await screen.findAllByRole('option',{name:'Existing draft'}))[0]!);
 fireEvent.click(screen.getByRole('button',{name:'Confirm and open draft'}));
 await waitFor(()=>expect(getPage).toHaveBeenCalledWith(11,'draft-1'));
 await waitFor(()=>expect(apply).toHaveBeenCalledWith(11,{template_id:'college-department',version:1,mode:'replace',page_id:'draft-1'},expect.any(String),'"cms-content-draft-1-r2"'));
 expect(opened).toHaveBeenCalledWith({id:'draft-1'});
});

it('requires Site media binding before applying an illustrated starter',async()=>{
 load.mockResolvedValue({ok:true,data:[{...entries[0],media_slots:[{code:'hero',label:'Hero photograph',node_ids:['hero']}]}]});
 render(<HomepageTemplateCatalogue siteId={11} canEdit onApplied={vi.fn()}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Preview University Main'}));
 expect(screen.getByRole('button',{name:'Choose Hero photograph'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Apply University Main as draft'}));
 expect(screen.getByRole('button',{name:'Confirm and open draft'}).hasAttribute('disabled')).toBe(true);
 expect(apply).not.toHaveBeenCalled();
});
