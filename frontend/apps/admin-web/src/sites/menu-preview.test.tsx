import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
const load=vi.fn();let site=11,allowed=true,enabled=true;
vi.mock('@/sites/site-admin-frame',()=>({useSiteAdmin:()=>({site:{id:site,name:'Informatics'},enabledModuleCodes:enabled?['MENUS']:[],permissions:allowed?['menu.write']:[]})}));
vi.mock('@/app/sites/menu-actions',()=>({loadNavigationPreview:(...args:unknown[])=>load(...args)}));
import {MenuPreviewScreen} from './menu-preview';
const payload={site:11,name:'Informatics',public_origin:'https://informatics.example',preview:true,locations:{header:[{label:'Private draft label',href:'/about',children:[]}],footer:[],sidebar:[]}};
beforeEach(()=>{vi.clearAllMocks();site=11;allowed=true;enabled=true;load.mockResolvedValue({ok:true,data:payload});});
it('uses saved draft context, correct public hostname and active link state',async()=>{
 render(<MenuPreviewScreen menuId="menu-one"/>);const link=await screen.findByRole('link',{name:'Private draft label'});
 expect(load).toHaveBeenCalledWith(11,'menu-one');expect(link.getAttribute('href')).toBe('https://informatics.example/about');expect(link.getAttribute('target')).toBe('_blank');
 fireEvent.change(screen.getByRole('textbox',{name:'Preview current path'}),{target:{value:'/about'}});
 expect(link.getAttribute('aria-current')).toBe('page');
});
it('blocks unauthorized or disabled preview without requesting private content',()=>{
 allowed=false;const view=render(<MenuPreviewScreen/>);expect(screen.getByText(/editing permission is required/)).toBeTruthy();expect(load).not.toHaveBeenCalled();
 enabled=false;view.rerender(<MenuPreviewScreen/>);expect(screen.getByText(/MENUS module is disabled/)).toBeTruthy();expect(load).not.toHaveBeenCalled();
});
it('clears an old Site preview immediately and ignores a delayed result',async()=>{
 const result=render(<MenuPreviewScreen/>);await screen.findByRole('link',{name:'Private draft label'});
 load.mockReturnValue(new Promise(()=>{}));site=22;result.rerender(<MenuPreviewScreen/>);
 expect(screen.queryByRole('link',{name:'Private draft label'})).toBeNull();
 await waitFor(()=>expect(load).toHaveBeenLastCalledWith(22,undefined));
});
it('renders unavailable destinations without a link and disables relative links without a hostname',async()=>{
 load.mockResolvedValue({ok:true,data:{...payload,public_origin:null,locations:{header:[{label:'Unavailable item',href:'',destination_status:'unavailable'},{label:'No domain link',href:'/about'}]}}});
 render(<MenuPreviewScreen/>);await screen.findByText('Unavailable item (unavailable)');expect(screen.queryByRole('link',{name:/No domain link/})).toBeNull();expect(screen.getByText(/No active primary hostname/)).toBeTruthy();
});

it('clears a rendered private preview when refresh is denied',async()=>{
 render(<MenuPreviewScreen/>);await screen.findByRole('link',{name:'Private draft label'});
 load.mockResolvedValue({ok:false,error:{status:403,code:'permission_denied',message:'Access revoked',details:null,requestId:null}});
 fireEvent.click(screen.getByRole('button',{name:'Refresh saved draft'}));
 expect(await screen.findByText('Access revoked')).toBeTruthy();
 expect(screen.queryByRole('link',{name:'Private draft label'})).toBeNull();
});

vi.mock("@/data/read-client",async()=>{const menus=await import("@/app/sites/menu-actions");return {loadSiteNavigation:(...args:unknown[])=>(menus.loadSiteNavigation as (...values:unknown[])=>unknown)(...args.slice(0,2))};});
