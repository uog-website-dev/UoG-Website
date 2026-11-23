import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PublicSiteSearch} from './public-site-search';
import {EMPTY_SITE} from './public-site';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const site={...EMPTY_SITE,id:11,displayName:'Informatics',modules:{...EMPTY_SITE.modules,pages:true,posts:true}};
it('shows only validated same-Site search links and closes with Escape',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({site:11,count:2,results:[{title:'Research',href:'/research',kind:'page'},{title:'Unsafe',href:'javascript:alert(1)',kind:'page'}]})}));
 render(<PublicSiteSearch site={site}/>);fireEvent.click(screen.getByRole('button',{name:'Search this Site'}));fireEvent.change(screen.getByRole('textbox',{name:'Search published Pages and news'}),{target:{value:'research'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(await screen.findByRole('link',{name:'Research'})).toBeTruthy();expect(screen.queryByText('Unsafe')).toBeNull();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('aborts and clears a pending search when the Site changes',async()=>{
 let finish:(value:unknown)=>void=()=>{};const fetch=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetch);
 const {rerender}=render(<PublicSiteSearch site={site}/>);fireEvent.click(screen.getByRole('button',{name:'Search this Site'}));fireEvent.change(screen.getByRole('textbox',{name:'Search published Pages and news'}),{target:{value:'research'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));rerender(<PublicSiteSearch site={{...site,id:12,displayName:'Medicine'}}/>);expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);finish({ok:true,json:async()=>({site:11,count:1,results:[{title:'Old Site secret',href:'/old',kind:'page'}]})});fireEvent.click(await screen.findByRole('button',{name:'Search this Site'}));expect(screen.queryByText('Old Site secret')).toBeNull();
});

it('removes news results immediately when POSTS is disabled for the same Site',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({site:11,count:1,results:[{title:'Former news',href:'/posts/former-news',kind:'post'}]})}));
 const {rerender}=render(<PublicSiteSearch site={site}/>);fireEvent.click(screen.getByRole('button',{name:'Search this Site'}));fireEvent.change(screen.getByRole('textbox',{name:'Search published Pages and news'}),{target:{value:'news'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));await screen.findByRole('link',{name:'Former news'});rerender(<PublicSiteSearch site={{...site,modules:{...site.modules,posts:false}}}/>);expect(screen.queryByText('Former news')).toBeNull();
});
