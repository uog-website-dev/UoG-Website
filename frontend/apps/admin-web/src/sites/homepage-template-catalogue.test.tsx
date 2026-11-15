import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,it,expect,vi} from "vitest";
const load=vi.fn(),prepare=vi.fn();
vi.mock("@/app/sites/homepage-template-actions",()=>({loadHomepageTemplates:(...args:unknown[])=>load(...args),prepareHomepageTemplate:(...args:unknown[])=>prepare(...args)}));
import {HomepageTemplateCatalogue} from "./homepage-template-catalogue";
const layout={schema_version:1 as const,rows:[]};
const entries=['University Main','College/Department','Blank'].map((name,i)=>({manifest_version:1,id:['university-main','college-department','blank'][i],version:1,name,description:'Approved starting design '+name,required_modules:['PAGES','VISUAL_BUILDER'],layout,available:true,unavailable_reasons:[]}));
beforeEach(()=>{vi.clearAllMocks();load.mockResolvedValue({ok:true,data:entries});prepare.mockResolvedValue({ok:true,data:layout});});
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
