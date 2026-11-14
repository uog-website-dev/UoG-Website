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
