import {fireEvent,render,screen,within,waitFor} from '@/test/render';
import {beforeEach,expect,it,vi} from 'vitest';
const load=vi.fn(),save=vi.fn(),publish=vi.fn();
vi.mock('@/app/sites/menu-actions',()=>({loadMenuLocations:(...args:unknown[])=>load(...args),saveMenuLocation:(...args:unknown[])=>save(...args),publishMenuLocation:(...args:unknown[])=>publish(...args),saveFooterMenus:(...args:unknown[])=>save(...args)}));
import {MenuLocationPanel} from './menu-locations';
const row={location:'header',label:'Primary Header',version:2,draft_menu:'one',published_menu:'one',is_published:true,has_changes:false};
const menus=[{id:'one',site:11,name:'Institution',location:'',is_active:true,is_global:false},{id:'two',site:11,name:'Students',location:'',is_active:true,is_global:false},{id:'foreign',site:22,name:'Foreign secret',location:'',is_active:true,is_global:false}];
beforeEach(()=>{vi.clearAllMocks();load.mockResolvedValue({ok:true,data:[row]});save.mockResolvedValue({ok:true,data:{...row,version:3,draft_menu:'two',has_changes:true}});publish.mockResolvedValue({ok:true,data:{...row,version:4,published_menu:'two',draft_menu:'two'}});});
function view(site=11,canWrite=true,canPublish=true){return <MenuLocationPanel site={site} menus={menus} enabled canWrite={canWrite} canPublish={canPublish}/>;}
it('requires explicit replacement and keeps separate save and publish actions',async()=>{
 render(view());const select=await screen.findByRole('combobox',{name:'Primary Header draft menu'});
 expect(screen.queryByRole('option',{name:/Foreign secret/})).toBeNull();
 fireEvent.change(select,{target:{value:'two'}});
 expect(screen.getByRole('button',{name:'Save Primary Header draft'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('checkbox',{name:'Replace current Primary Header menu'}));
 fireEvent.click(screen.getByRole('button',{name:'Save Primary Header draft'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(11,'header',2,'two',true));expect(publish).not.toHaveBeenCalled();
 expect(screen.getByText('Public: Institution')).toBeTruthy();
});
it('publishes the backend-confirmed version, and supports unassignment drafts',async()=>{
 load.mockResolvedValue({ok:true,data:[{...row,has_changes:true,draft_menu:'two',version:3}]});render(view());
 fireEvent.click(await screen.findByRole('button',{name:'Publish Primary Header'}));
 await waitFor(()=>expect(publish).toHaveBeenCalledWith(11,'header',3));
 fireEvent.change(screen.getByRole('combobox',{name:'Primary Header draft menu'}),{target:{value:''}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save Primary Header draft'})).toHaveProperty('disabled',false));
 fireEvent.click(screen.getByRole('button',{name:'Save Primary Header draft'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(11,'header',3,null,false));
});
it('hides unauthorized writes and clears the old Site while a new request is pending',async()=>{
 const result=render(view(11,false,false));await screen.findByText('Public: Institution');expect(screen.queryByRole('button',{name:'Save Primary Header draft'})).toBeNull();expect(screen.queryByRole('button',{name:'Publish Primary Header'})).toBeNull();
 load.mockReturnValue(new Promise(()=>{}));result.rerender(view(22,false,false));expect(screen.queryByText('Public: Institution')).toBeNull();
});
it('retains a selection after a conflict and offers a refresh action',async()=>{
 save.mockResolvedValue({ok:false,error:{status:409,code:'conflict',message:'Conflict',details:{reason:'version_conflict'},requestId:null}});render(view());
 fireEvent.change(await screen.findByRole('combobox',{name:'Primary Header draft menu'}),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'Save Primary Header draft'}));expect((await screen.findByRole('alert')).textContent).toContain('This location changed');expect(screen.getByRole('combobox',{name:'Primary Header draft menu'})).toHaveProperty('value','');expect(screen.getByRole('button',{name:'Refresh locations'})).toBeTruthy();
});

it('shows the backend destination validation without losing the saved draft choice',async()=>{
 load.mockResolvedValue({ok:true,data:[{...row,draft_menu:'two',has_changes:true}]});
 publish.mockResolvedValue({ok:false,error:{status:400,code:'validation_error',message:'Invalid',details:{fields:{menu:['Publish the selected menu first.']}},requestId:null}});
 render(view());fireEvent.click(await screen.findByRole('button',{name:'Publish Primary Header'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Publish the selected menu first.');
 expect(screen.getByRole('combobox',{name:'Primary Header draft menu'})).toHaveProperty('value','two');
});

vi.mock("@/data/read-client",async()=>{const menus=await import("@/app/sites/menu-actions");return {loadSiteNavigation:(...args:unknown[])=>(menus.loadSiteNavigation as (...values:unknown[])=>unknown)(...args.slice(0,2))};});


it('adds ordered same-Site footer columns and saves before publishing',async()=>{
 load.mockResolvedValue({ok:true,data:[{...row,location:'footer',label:'Footer',draft_menus:['one'],published_menus:['one'],has_changes:true}]});
 render(view());
 await screen.findByRole('combobox',{name:'Footer column 1 menu'});
 fireEvent.click(screen.getByRole('button',{name:'Add footer column'}));
 expect(screen.getByRole('button',{name:'Save Footer draft'})).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByRole('combobox',{name:'Footer column 2 menu'}),{target:{value:'two'}});
 expect(screen.getByRole('button',{name:'Publish Footer'})).toHaveProperty('disabled',false);
 expect(screen.queryByRole('option',{name:/Foreign secret/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Save Footer draft'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(11,2,['one','two'],false));
});


it('publishes edited footer columns using the version returned by the save',async()=>{
 const footer={...row,location:'footer',label:'Footer',draft_menus:['one'],published_menus:['one']};
 load.mockResolvedValue({ok:true,data:[footer]});
 save.mockResolvedValue({ok:true,data:{...footer,version:3,draft_menus:['one','two'],has_changes:true}});
 publish.mockResolvedValue({ok:true,data:{...footer,version:4,draft_menus:['one','two'],published_menus:['one','two']}});
 render(view());
 await screen.findByRole('combobox',{name:'Footer column 1 menu'});
 expect(screen.getByRole('button',{name:'Publish Footer'})).toHaveProperty('disabled',false);
 fireEvent.click(screen.getByRole('button',{name:'Add footer column'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Footer column 2 menu'}),{target:{value:'two'}});
 fireEvent.click(screen.getByRole('button',{name:'Publish Footer'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(11,2,['one','two'],false));
 await waitFor(()=>expect(publish).toHaveBeenCalledWith(11,'footer',3));
});


it('keeps a saved footer and shows a publish failure so it can be retried',async()=>{
 const footer={...row,location:'footer',label:'Footer',draft_menus:['one'],published_menus:['one']};
 const saved={...footer,version:3,draft_menus:['one','two'],has_changes:true};
 load.mockResolvedValue({ok:true,data:[footer]});
 save.mockImplementation(async()=>{load.mockResolvedValue({ok:true,data:[saved]});return {ok:true,data:saved};});
 publish.mockResolvedValue({ok:false,error:{status:400,code:'validation_error',message:'Invalid',details:{fields:{menus:['Publish every selected menu first.']}},requestId:null}});
 render(view());await screen.findByRole('combobox',{name:'Footer column 1 menu'});
 fireEvent.click(screen.getByRole('button',{name:'Add footer column'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Footer column 2 menu'}),{target:{value:'two'}});
 fireEvent.click(screen.getByRole('button',{name:'Publish Footer'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Publish every selected menu first.');
 expect(screen.getByRole('combobox',{name:'Footer column 2 menu'})).toHaveProperty('value','two');
});
