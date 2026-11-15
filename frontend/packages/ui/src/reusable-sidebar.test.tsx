import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { pageFromResponse, PublicPageView } from './public-page';
const snapshot = { id: 'sidebar', site: 11, version: 1, name: 'Department links', components: [{ id: 'menu-one', type: 'menu', menu_id: 'one', items: [{ label: 'Students', href: '/students', children: [{ label: 'Help', href: '/help', children: [] }] }] }] };
const body = { id: 'page', site: 11, title: 'Information', path: '/information', layout: 'LEFT_SIDEBAR', sidebar_id: 'sidebar', sidebar_snapshot: snapshot, blocks: [] };
afterEach(() => vi.unstubAllGlobals());
it('renders frozen ordered menu links without fetching a live definition', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<PublicPageView page={pageFromResponse(200, body)} />);
  expect(screen.getByRole('heading', { name: 'Department links' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Students' }).getAttribute('href')).toBe('/students');
  expect(screen.getByRole('link', { name: 'Help' })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['foreign', 'script', 'unavailable'])('rejects %s sidebar data and does not replace it with live Site navigation', kind => {
  const value = structuredClone(snapshot);
  if (kind === 'foreign') value.site = 12;
  if (kind === 'script') value.components[0].items[0].href = 'javascript:alert(1)';
  render(<PublicPageView page={pageFromResponse(200, { ...body, sidebar_snapshot: kind === 'unavailable' ? {} : value })} />);
  expect(screen.getByText('Navigation is currently unavailable.')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});
it('escapes untrusted sidebar and link labels on public and private surfaces', () => {
  const value = structuredClone(snapshot); value.name = '<script>attack()</script>'; value.components[0].items[0].label = '<img onerror=attack()>';
  render(<PublicPageView page={pageFromResponse(200, { ...body, sidebar_snapshot: value })} privateMediaBase='/admin/media' />);
  expect(screen.getByText('<script>attack()</script>')).toBeTruthy();
  expect(document.querySelector('aside script, aside img')).toBeNull();
});

it('renders mixed component order and accessible source-specific placeholders', () => {
  const value = {...snapshot, components:[
    {id:'pages',type:'related_pages',title:'Related information',items:[],state:'empty'},
    {id:'posts',type:'recent_posts',title:'News updates',items:[],state:'unavailable'},
    snapshot.components[0],
  ]};
  render(<PublicPageView page={pageFromResponse(200,{...body,sidebar_snapshot:value})} />);
  expect(screen.getByText('No published related Pages yet.')).toBeTruthy();
  expect(screen.getByText('This content is currently unavailable.')).toBeTruthy();
  expect(screen.getAllByRole('navigation').map(node => node.getAttribute('aria-label'))).toEqual(['Related information','News updates','Department links']);
  expect(screen.getByRole('link',{name:'Students'})).toBeTruthy();
});

it('renders a published template sidebar slot without replacing an explicit Page sidebar', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => ({ok:true,json:async()=>url.includes('/menus/')?{site:11,configured_locations:['sidebar'],locations:{sidebar:[{label:'Template contacts',href:'/contacts',children:[]}]}}:{results:[]}})));
  render(<PublicPageView page={pageFromResponse(200,{...body,sidebar_id:null,sidebar_snapshot:undefined})}/>);
  expect(await screen.findByRole('link',{name:'Template contacts'})).toBeTruthy();
});
it('honors a published empty sidebar assignment rather than restoring automatic links', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => ({ok:true,json:async()=>url.includes('/menus/')?{site:11,configured_locations:['sidebar'],locations:{sidebar:[]}}:{results:[]}})));
  render(<PublicPageView page={pageFromResponse(200,{...body,sidebar_id:null,sidebar_snapshot:undefined})}/>);
  expect(await screen.findByText('No navigation is assigned to this location.')).toBeTruthy();
  expect(screen.queryByRole('link',{name:'Site home'})).toBeNull();
});
