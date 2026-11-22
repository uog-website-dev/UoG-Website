import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PublicPageView,pageFromResponse} from './public-page';
import {VisualLayoutView} from './visual-layout';
import {VideoPlayer,LocationMap,Countdown} from './utility-widgets';
import type {WidgetNode} from '@uog/types';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const scene=(widgets:WidgetNode[])=>({schema_version:1,rows:[{id:'row',type:'section',ratios:[100],columns:[{id:'column',type:'column',children:widgets}]}]});
it('renders featured Site news with publication dates and rejects foreign rows',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({site:11,results:[{id:'a',site:11,title:'Our news',slug:'our-news',excerpt:'Published summary',featured_media:'',published_at:'2026-11-22T10:00:00Z'},{id:'b',site:12,title:'Foreign news',slug:'foreign-news',excerpt:'Secret',featured_media:''}]})}));
 render(<VisualLayoutView layout={scene([{id:'news',type:'blog',props:{source:'posts',limit:4,presentation:'featured'}}]) as never} siteId={11} pageTitle="Home"/>);
 expect(await screen.findByRole('link',{name:'Our news'})).toBeTruthy();expect(screen.queryByText('Foreign news')).toBeNull();expect(screen.getByText('Nov 22, 2026')).toBeTruthy();
});
it('renders working taxonomy and content carousel instead of integration placeholders',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation((url:string)=>Promise.resolve({ok:true,json:async()=>({site:11,results:url.includes('taxonomy')?[{id:'t',slug:'research',name:'Research'}]:[{id:'a',site:11,title:'First story',slug:'first-story',excerpt:'Summary',featured_media:''},{id:'b',site:11,title:'Second story',slug:'second-story',excerpt:'Summary',featured_media:''}]})})));
 render(<VisualLayoutView layout={scene([{id:'taxonomy',type:'taxonomy',props:{taxonomy_code:'categories',limit:10}},{id:'carousel',type:'post_carousel',props:{source:'posts',limit:4}}]) as never} siteId={11} pageTitle="Home"/>);
 expect((await screen.findByRole('link',{name:'Research'})).getAttribute('href')).toBe('/posts/categories/research');await screen.findByText('First story');fireEvent.click(screen.getByRole('button',{name:'Go to slide 2'}));expect(screen.getByText('Second story')).toBeTruthy();expect(screen.queryByText('First story')).toBeNull();
});
it('builds a Page-local table of contents and focuses its section',async()=>{
 const doc=scene([{id:'toc',type:'table_of_contents',props:{title:'On this Page',max_level:3}},{id:'heading',type:'headline',props:{text:'Our research',level:2}}]);
 render(<PublicPageView page={pageFromResponse(200,{title:'Page',site:11,blocks:[],metadata:{visual_layout:doc}})}/>);
 const link=await screen.findByRole('link',{name:'Our research'});fireEvent.click(link);expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Our research'}));
});
it('loads only allowlisted video and map frames after visitor consent',()=>{
 const view=render(<VideoPlayer provider="youtube" video_id="abc123" title="Campus tour"/>);expect(view.container.querySelector('iframe')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Load video'}));expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc123');view.unmount();
 const map=render(<LocationMap latitude={12.6} longitude={37.4} zoom={12} title="Campus location"/>);expect(map.container.querySelector('iframe')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Load map'}));expect(map.container.querySelector('iframe')?.getAttribute('src')).toContain('https://www.google.com/maps?');
});
it('shows a completed countdown without noisy live announcements',async()=>{
 render(<Countdown ends_at="2020-01-01T00:00:00Z" label="Open day"/>);await screen.findByText('Event has started.');expect(screen.getByRole('timer').getAttribute('aria-live')).toBe('off');
});
