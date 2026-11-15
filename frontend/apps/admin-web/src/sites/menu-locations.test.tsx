import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const load=vi.fn(),save=vi.fn(),publish=vi.fn();
vi.mock('@/app/sites/menu-actions',()=>({loadMenuLocations:(...args:unknown[])=>load(...args),saveMenuLocation:(...args:unknown[])=>save(...args),publishMenuLocation:(...args:unknown[])=>publish(...args)}));
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
