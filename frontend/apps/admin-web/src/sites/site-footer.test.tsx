import {cleanup,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {EMPTY_SITE,PublicSiteFooter} from '@uog/ui';
import {defaultSiteFooter,footerSettingsFrom} from '@uog/types';
afterEach(cleanup);
it('renders grouped Site footer with safe social links and escaped content',()=>{
 const site={...EMPTY_SITE,id:16,displayName:'Informatics',footer:{...defaultSiteFooter(),description:'<script>alert(1)</script>',social_links:[{platform:'youtube' as const,url:'https://youtube.com/example'}]}};
 const {container}=render(<PublicSiteFooter site={site} items={[{label:'Resources',href:'/resources',children:[{label:'Library',href:'/library'}]}]}/>);
 expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
 expect(container.querySelector('script')).toBeNull();
 expect(within(screen.getByRole('contentinfo')).getByRole('link',{name:'Library'}).getAttribute('href')).toBe('/library');
 expect(screen.getByText(/Informatics. All rights reserved/)).toBeTruthy();
 expect(container.querySelector('a[href="https://youtube.com/example"]')?.getAttribute('rel')).toContain('noopener');
});
it('drops unsafe configuration URLs and duplicate social profiles',()=>{
 const parsed=footerSettingsFrom({highlight_url:'javascript:alert(1)',social_links:[{platform:'x',url:'https://x.com/a'},{platform:'x',url:'https://x.com/b'},{platform:'facebook',url:'javascript:alert(1)'}]});
 expect(parsed.highlight_url).toBe('');expect(parsed.social_links).toHaveLength(1);
});



it('keeps configured menus as separate equal-width columns, including an empty menu',()=>{
 const site={...EMPTY_SITE,id:16,displayName:'Informatics'};
 render(<PublicSiteFooter site={site} items={[
  {label:'University',href:'',column:true,children:[{label:'About',href:'/about'}]},
  {label:'Resources',href:'',column:true,children:[]},
  {label:'Community',href:'',column:true,children:[{label:'Contact',href:'/contact'}]},
 ]}/>);
 const nav=screen.getByRole('navigation',{name:'Footer navigation'});
 expect(within(nav).getAllByRole('heading').map(n=>n.textContent)).toEqual(['University','Resources','Community']);
 expect(within(nav).getByRole('link',{name:'About'}).getAttribute('href')).toBe('/about');
 expect(within(nav).getByRole('link',{name:'Contact'}).getAttribute('href')).toBe('/contact');
 expect(nav.children).toHaveLength(3);
});
