import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ listSiteSidebars: vi.fn(), sidebarMenuOptions: vi.fn(), saveSiteSidebar: vi.fn(), deleteSiteSidebar: vi.fn() }));
vi.mock("@/app/sites/sidebar-actions", () => mocks);
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a> }));
import { SiteSidebars } from "./site-sidebars";
const record = { id: 'sidebar-1', site: 11, name: 'Department links', version: 1, status: 'ACTIVE', components: [{ id: 'menu-a', type: 'menu', menu_id: 'a' }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSiteSidebars.mockResolvedValue({ ok: true, data: [] });
  mocks.sidebarMenuOptions.mockResolvedValue({ ok: true, data: [{ id: 'a', name: 'Department menu', location: 'sidebar' }, { id: 'b', name: 'Student menu', location: 'secondary' }] });
  mocks.saveSiteSidebar.mockResolvedValue({ ok: true, data: record });
});
it('creates a named sidebar using an existing Menu reference', async () => {
  render(<SiteSidebars siteId={11} permissions={['content.pages.update']} menusEnabled />);
  await waitFor(() => expect(screen.queryByText('Loading sidebars…')).toBeNull());
  fireEvent.change(screen.getByRole('textbox', { name: 'Sidebar name' }), { target: { value: 'Department links' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Menu component' }));
  fireEvent.click(screen.getByRole('option', { name: 'Department menu (sidebar)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Menu component' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save sidebar' }));
  await waitFor(() => expect(mocks.saveSiteSidebar).toHaveBeenCalledWith(11, { name: 'Department links', status: 'ACTIVE', components: [{ id: expect.stringMatching(/^menu-/), type: 'menu', menu_id: 'a' }] }, undefined));
  await screen.findByText(/Sidebar saved/);
});
it('requires a name and component, without discarding the form', async () => {
  render(<SiteSidebars siteId={11} permissions={['content.pages.update']} menusEnabled />);
  await waitFor(() => expect(screen.queryByText('Loading sidebars…')).toBeNull());
  fireEvent.submit(screen.getByRole('form', { name: 'Sidebar editor' }));
  await screen.findByText('Enter a sidebar name and add at least one Menu component.');
  expect(mocks.saveSiteSidebar).not.toHaveBeenCalled();
});
it('retains edits after a rejected save and supplies the current version', async () => {
  mocks.listSiteSidebars.mockResolvedValue({ ok: true, data: [record] });
  mocks.saveSiteSidebar.mockResolvedValue({ ok: false, error: { status: 409, message: 'Sidebar changed. Reload and retry.', code: 'conflict', details: null, requestId: null } });
  render(<SiteSidebars siteId={11} permissions={['content.pages.update']} menusEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: 'Department links' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Sidebar name' }), { target: { value: 'Retain my edits' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save sidebar' }));
  await screen.findByText('Sidebar changed. Reload and retry.');
  expect((screen.getByRole('textbox', { name: 'Sidebar name' }) as HTMLInputElement).value).toBe('Retain my edits');
  expect(mocks.saveSiteSidebar.mock.calls[0][2]).toEqual(record);
});
it('excludes stale results after a Site change', async () => {
  let release!: (value: unknown) => void;
  mocks.listSiteSidebars.mockImplementation((site: number) => site === 11 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ok: true, data: [{ ...record, id: 'other', site: 12, name: 'Medicine links' }] }));
  const view = render(<SiteSidebars siteId={11} permissions={['content.pages.update']} menusEnabled />);
  view.rerender(<SiteSidebars siteId={12} permissions={['content.pages.update']} menusEnabled />);
  await screen.findByRole('button', { name: 'Medicine links' });
  release({ ok: true, data: [record] });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Department links' })).toBeNull());
});
it('offers no write controls to a read-only user and gates Menu use', async () => {
  render(<SiteSidebars siteId={11} permissions={[]} menusEnabled={false} />);
  await waitFor(() => expect(screen.queryByText('Loading sidebars…')).toBeNull());
  expect(screen.queryByRole('button', { name: 'New sidebar' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Save sidebar' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.sidebarMenuOptions).not.toHaveBeenCalled();
});
