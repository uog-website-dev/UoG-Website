import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { menusFromResponse, PublicMenuFrame, safeMenuHref, SiteNavigation } from "./site-navigation";

const header = [
  { label: "Department", href: "/about", children: [{ label: "People", href: "/about/people" }] },
  { label: "Blocked", href: "javascript:alert(1)" },
];
const footer = [{ label: "Contacts", href: "/contacts" }];

describe("safeMenuHref", () => {
  it("keeps same-site paths and http(s) URLs", () => {
    expect(safeMenuHref("/about")).toBe("/about");
    expect(safeMenuHref("https://example.com/news")).toBe("https://example.com/news");
  });

  it("rejects scriptable, protocol-relative and credentialed targets", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,bad", "//evil.example", "https://user:pass@example.com/"]) {
      expect(safeMenuHref(value)).toBeNull();
    }
  });
});

describe("menusFromResponse", () => {
  it("reads only the resolved Site header and footer", () => {
    const parsed = menusFromResponse(200, {
      site: 11,
      locations: {
        header: [{ label: "Department", href: "/about", children: [] }],
        footer: [{ label: "Contacts", href: "/contacts", children: [] }],
        sidebar: [{ label: "Not shown", href: "/side" }],
      },
      otherSite: [{ label: "Hospital", href: "/hospital" }],
    });
    expect(parsed.header.map((item) => item.label)).toEqual(["Department"]);
    expect(parsed.footer.map((item) => item.label)).toEqual(["Contacts"]);
    expect(JSON.stringify(parsed)).not.toContain("Hospital");
  });

  it("treats a disabled module as an empty menu", () => {
    expect(menusFromResponse(404, { error: { code: "not_found" } })).toEqual({
      header: [],
      footer: [],
    });
  });
});

describe("PublicMenuFrame", () => {
  it("shows this Site's header and footer and does not link unsafe URLs", () => {
    render(
      <PublicMenuFrame header={header} footer={footer}>
        <p>Page</p>
      </PublicMenuFrame>,
    );
    fireEvent.click(screen.getByRole("button", {name:"Department"}));
    expect(screen.getAllByRole("link", { name: "Overview", hidden: true }).every((link) => link.getAttribute("href") === "/about")).toBe(true);
    expect(screen.getByRole("link", { name: "Contacts" }).getAttribute("href")).toBe("/contacts");
    expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
    expect(screen.getByText("Blocked").tagName).toBe("SPAN");
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("opens the mobile header from the keyboard and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(
      <PublicMenuFrame header={header} footer={footer}>
        <p>Page</p>
      </PublicMenuFrame>,
    );
    const open = screen.getByRole("button", { name: "Open site header" });
    open.focus();
    expect(document.activeElement).toBe(open);
    await user.keyboard("{Enter}");
    const drawerPaper = document.querySelector(".MuiDrawer-paper");
    expect(drawerPaper).toBeTruthy();
    const drawer = within(drawerPaper as HTMLElement);
    await user.click(drawer.getByRole("button",{name:"Department"}));
    expect(drawer.getByRole("link", { name: "People" })).toBeTruthy();
    expect(open.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector(".MuiDrawer-paper")).toBeNull());
  });

  it("closes the mobile header from its close button", async () => {
    render(
      <PublicMenuFrame header={[{ label: "Department", href: "/about" }]} footer={[]}>
        <p>Page</p>
      </PublicMenuFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open site header" }));
    const drawerPaper = document.querySelector(".MuiDrawer-paper") as HTMLElement;
    fireEvent.click(within(drawerPaper).getByRole("button", { name: "Close site header" }));
    await waitFor(() => expect(document.querySelector(".MuiDrawer-paper")).toBeNull());
  });
});

it('resolves utility navigation independently of primary and footer menus', () => {
  const parsed=menusFromResponse(200,{locations:{header:[{label:'Primary',href:'/primary'}],secondary:[{label:'Utility',href:'/utility'}],footer:[{label:'Footer',href:'/footer'}]}});
  expect(parsed.utility?.[0]?.label).toBe('Utility');
  expect(parsed.header[0]?.label).toBe('Primary');
  expect(parsed.footer[0]?.label).toBe('Footer');
});

it('marks only the exact same-origin current destination and qualifies private preview links', () => {
 render(<SiteNavigation label="Preview header" items={[...header,{label:'External same path',href:'https://other.example/about/people'}]} currentPath="/about/people" siteOrigin="https://informatics.example"/>);
 const person=screen.getByRole('link',{name:'People'});
 expect(person.getAttribute('href')).toBe('https://informatics.example/about/people');
 expect(person.getAttribute('aria-current')).toBe('page');
 expect(screen.getByRole('link',{name:'Department'}).getAttribute('aria-current')).toBeNull();
 expect(screen.getByRole('link',{name:'External same path'}).getAttribute('aria-current')).toBeNull();
});
it('closes the mobile menu after activating a nested link and restores the trigger', async () => {
 render(<SiteNavigation label="Test navigation" items={header} mobile/>);
 const open=screen.getByRole('button',{name:'Open test navigation'});fireEvent.click(open);
 const drawer=within(document.querySelector('.MuiDrawer-paper') as HTMLElement);
 fireEvent.click(drawer.getByRole('button',{name:'Department'}));
 const link=drawer.getByRole('link',{name:'People'});link.addEventListener('click',event=>event.preventDefault());fireEvent.click(link);
 await waitFor(()=>expect(document.querySelector('.MuiDrawer-paper')).toBeNull());
 expect(open.getAttribute('aria-expanded')).toBe('false');
});
it('bounds malformed trees and rejects encoded controls and error response trees', () => {
 const tree={label:'Root',href:'/root',children:[] as unknown[]};let cursor=tree;
 for(let i=0;i<100;i++){const child={label:'Nested',href:'/nested',children:[] as unknown[]};cursor.children.push(child);cursor=child;}
 const parsed=menusFromResponse(200,{locations:{header:[tree]}});expect(JSON.stringify(parsed).match(/Nested/g)?.length).toBe(5);
 expect(menusFromResponse(500,{locations:{header}})).toEqual({header:[],footer:[]});
 for(const href of ['/bad%0aheader','https://example.com/%5cpath','/bad%ZZ'])expect(safeMenuHref(href)).toBeNull();
});
it('opens a disclosure with ArrowDown and returns focus on Escape', async () => {
 const user=userEvent.setup();render(<SiteNavigation label="Dropdown" items={header} dropdown/>);
 const trigger=screen.getByRole('button',{name:'Department'});trigger.focus();await user.keyboard('{ArrowDown}');
 expect(trigger.getAttribute('aria-expanded')).toBe('true');
 expect(document.activeElement).toBe(screen.getByRole('link',{name:'Overview'}));
 await user.keyboard('{Escape}');expect(trigger.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(trigger);
});

it('escapes hostile labels on public and preview surfaces and keeps empty frames stable', () => {
 const text='<img src=x onerror="window.menuInjected=1">';
 const view=render(<PublicMenuFrame header={[{label:text,href:'javascript:alert(1)'}]} footer={[]}><p>Readable body</p></PublicMenuFrame>);
 expect(screen.getByText(text)).toBeTruthy();expect(screen.queryByRole('link',{name:text})).toBeNull();expect(document.querySelector('img[src="x"]')).toBeNull();
 view.rerender(<PublicMenuFrame header={[]} footer={[]}><p>Readable body</p></PublicMenuFrame>);
 expect(screen.getByText('Readable body')).toBeTruthy();expect(screen.queryByRole('navigation')).toBeNull();
});

it('tracks the actual public browser pathname and history navigation',async()=>{
 const previous=window.location.href;
 try{
  window.history.replaceState({},'', '/about/people');render(<SiteNavigation items={[...header,...footer]} label="Public navigation"/>);
  await waitFor(()=>expect(screen.getByRole('link',{name:'People'}).getAttribute('aria-current')).toBe('page'));
  window.history.replaceState({},'', '/contacts');fireEvent(window,new PopStateEvent('popstate'));
  await waitFor(()=>expect(screen.getByRole('link',{name:'Contacts'}).getAttribute('aria-current')).toBe('page'));
  expect(screen.getByRole('link',{name:'People'}).getAttribute('aria-current')).toBeNull();
 }finally{window.history.replaceState({},'',previous);}
});


it('keeps one dropdown open, switches on hover, and closes on outside click',async()=>{
 const user=userEvent.setup();const items=[header[0]!,{label:"Research",href:"/research",children:[{label:"Projects",href:"/projects"}]}];
 render(<><SiteNavigation label="Primary" items={items} dropdown/><button>Outside</button></>);
 const first=screen.getByRole('button',{name:'Department'}),second=screen.getByRole('button',{name:'Research'});
 await user.hover(first);expect(first.getAttribute('aria-expanded')).toBe('true');
 await user.hover(second);expect(first.getAttribute('aria-expanded')).toBe('false');expect(second.getAttribute('aria-expanded')).toBe('true');
 expect(screen.queryByRole('region',{name:'Department links'})).toBeNull();expect(screen.getAllByRole('region')).toHaveLength(1);
 await user.click(screen.getByRole('button',{name:'Outside'}));expect(second.getAttribute('aria-expanded')).toBe('false');
});
it('closes disclosures across separate navigation instances and on focus leaving',async()=>{
 const user=userEvent.setup();render(<><SiteNavigation label="Header" items={header} dropdown/><SiteNavigation label="Body" items={[{label:"Other",href:"/other",children:[{label:"More",href:"/more"}]}]} dropdown/><button>After navigation</button></>);
 const first=screen.getByRole('button',{name:'Department'}),second=screen.getByRole('button',{name:'Other'});
 await user.click(first);await user.click(second);expect(first.getAttribute('aria-expanded')).toBe('false');expect(second.getAttribute('aria-expanded')).toBe('true');
 screen.getByRole('button',{name:'After navigation'}).focus();await waitFor(()=>expect(second.getAttribute('aria-expanded')).toBe('false'));
});
it('uses column groups for nested navigation and preserves every destination',async()=>{
 const user=userEvent.setup();render(<SiteNavigation label="Primary" dropdown items={[{label:"Academics",href:"/academics",children:[{label:"Colleges",href:"/colleges",children:[{label:"Informatics",href:"/informatics"}]},{label:"Institutes",href:"/institutes",children:[{label:"Technology",href:"/technology"}]}]}]}/>);
 await user.click(screen.getByRole('button',{name:'Academics'}));
 expect(screen.getByRole('link',{name:'Informatics'}).getAttribute('href')).toBe('/informatics');
 expect(screen.getByRole('link',{name:'View all institutes'}).getAttribute('href')).toBe('/institutes');
});


it('skips unavailable root labels when moving between top-level controls',async()=>{
 const user=userEvent.setup();render(<SiteNavigation label="Primary" dropdown items={[...header,{label:"News",href:"/posts"}]}/>);
 screen.getByRole('button',{name:'Department'}).focus();await user.keyboard('{ArrowRight}');
 expect(document.activeElement).toBe(screen.getByRole('link',{name:'News'}));
});


function fiveSubmenus() {
 let node={label:'Level 5',href:'/level-5',children:[] as any[]};
 for(let level=4;level>=0;level--)node={label:level===0?'Academics':`Level ${level}`,href:`/level-${level}`,children:[node]};
 return [node];
}
it('preserves five submenu levels and opens deep desktop branches by keyboard',async()=>{
 const user=userEvent.setup();
 const nodes=menusFromResponse(200,{locations:{header:fiveSubmenus()}}).header;
 render(<SiteNavigation label="Deep desktop" dropdown items={nodes}/>);
 await user.click(screen.getByRole('button',{name:'Academics'}));
 for(const level of [2,3,4]){
  const toggle=screen.getByRole('button',{name:`Show Level ${level} submenu`});
  toggle.focus();await user.keyboard('{Enter}');expect(toggle.getAttribute('aria-expanded')).toBe('true');
 }
 const leaf=screen.getByRole('link',{name:'Level 5'});expect(leaf.getAttribute('href')).toBe('/level-5');
 leaf.focus();await user.keyboard('{Escape}');
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Show Level 4 submenu'}));
});
it('allows all five submenu levels in the mobile drawer without unsafe links',async()=>{
 const user=userEvent.setup();render(<SiteNavigation label="Deep mobile" mobile items={fiveSubmenus()}/>);
 await user.click(screen.getByRole('button',{name:'Open deep mobile'}));
 const drawer=within(document.querySelector('.MuiDrawer-paper') as HTMLElement);
 for(const label of ['Academics','Level 1','Level 2','Level 3','Level 4'])await user.click(drawer.getByRole('button',{name:label,exact:true}));
 expect(drawer.getByRole('link',{name:'Level 5'}).getAttribute('href')).toBe('/level-5');
 await user.keyboard('{Escape}');expect(drawer.getByRole('button',{name:'Level 4'}).getAttribute('aria-expanded')).toBe('false');
});
