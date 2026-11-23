import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {defaultSiteFooter} from '@uog/types';
import {SiteFooterPanel} from './site-footer-panel';
const actions=vi.hoisted(()=>({getSiteFooter:vi.fn(),updateSiteFooter:vi.fn(),publishSiteFooter:vi.fn(),restorePreviousSiteFooter:vi.fn()}));
vi.mock('@/app/sites/footer-actions',()=>actions);
vi.mock('./site-admin-frame',()=>({useSiteAdmin:()=>({site:{id:16,name:'Informatics'},enabledModuleCodes:['MENUS']})}));
vi.mock('./site-draft-guard',()=>({useSiteDraftGuard:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const envelope={site:16,version:1,settings:defaultSiteFooter(),published_settings:defaultSiteFooter(),has_unpublished_changes:false,published_at:null,previous_available:false,columns:[],menu_items:[],site_origin:'http://coi.uog.local',branding:{name:'Informatics',theme:'institutional' as const,logo_asset_id:null}};
function open(extra:Record<string,unknown>={}){actions.getSiteFooter.mockResolvedValue({ok:true,data:{etag:'"v1"',data:{...envelope,...extra}}});render(<SiteFooterPanel/>);return screen.findByRole('textbox',{name:'Short description'});}
it('preserves unsaved text after a rejected concurrent save',async()=>{
 const input=await open();
 actions.updateSiteFooter.mockResolvedValue({ok:false,error:{status:412,message:'Conflict',code:'precondition_failed'}});
 fireEvent.change(input,{target:{value:'My unsaved introduction'}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await screen.findByText(/Footer changed in another session/);
 expect((input as HTMLInputElement).value).toBe('My unsaved introduction');
 expect(actions.updateSiteFooter).toHaveBeenCalledWith(16,'"v1"',expect.objectContaining({description:'My unsaved introduction'}));
});
it('publishes the saved draft only, showing warnings returned by the lint',async()=>{
 await open();
 actions.publishSiteFooter.mockResolvedValue({ok:true,data:{etag:'"v2"',data:{...envelope,version:2,published_at:'2026-11-23T10:00:00Z',has_unpublished_changes:false,lint_warnings:[{path:'columns.1.heading',message:'More than one footer column is titled “Explore”.'}]}}});
 fireEvent.click(screen.getByRole('button',{name:'Publish footer'}));
 await screen.findByText(/Footer published\. Visitors now see these values/);
 expect(actions.publishSiteFooter).toHaveBeenCalledWith(16,'"v1"');
 expect(screen.getByText(/More than one footer column is titled/)).toBeTruthy();
});
it('keeps publish disabled while edits are unsaved and restores the previous publication into the draft',async()=>{
 await open({previous_available:true});
 actions.restorePreviousSiteFooter.mockResolvedValue({ok:true,data:{etag:'"v3"',data:{...envelope,version:3,previous_available:true,has_unpublished_changes:true}}});
 vi.spyOn(window,'confirm').mockReturnValue(true);
 fireEvent.change(screen.getByRole('textbox',{name:'Short description'}),{target:{value:'Unsaved edit'}});
 expect((screen.getByRole('button',{name:'Publish footer'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Restore previous published footer'}));
 await screen.findByText(/Previous published footer restored into the draft/);
 expect(actions.restorePreviousSiteFooter).toHaveBeenCalledWith(16,'"v1"');
});
