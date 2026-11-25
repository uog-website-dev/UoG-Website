import {render,screen,fireEvent} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe,it,expect} from "vitest";
import {validateVisualLayout} from "@uog/types";
import type {VisualLayout} from "@uog/types";
import {HeroView} from "./visual-presentation";
import {PublicPageView,pageFromResponse} from "./public-page";

const image="00000000-0000-4000-8000-000000000001";
function scene():VisualLayout {
  return {schema_version:1,settings:{show_title:false,content_width:"wide"},rows:[{
    id:"row",type:"section",ratios:[100],style:{padding:"md",radius:"lg"},columns:[{
      id:"column",type:"column",children:[{id:"carousel",type:"layout_slider",props:{items:[
        {id:"slide-a",children:[{id:"hero-a",type:"hero_image",props:{asset_id:image,alt:"Research",title:"Discover research",layout:"split",mask:"curve",height:"compact",actions:[{id:"action-a",label:"Explore",href:"#research"}]}}]},
        {id:"slide-b",children:[{id:"hero-b",type:"hero_image",props:{asset_id:image,alt:"Campus",title:"Campus life",layout:"overlay",height:"medium"}}]},
      ]}}],
    }],
  }]};
}
describe("Professional visual presentation",()=>{
  for(const surface of ["public","preview"] as const)it(`renders and operates the same hero carousel in ${surface}`,async()=>{
    const layout=scene();
    expect(validateVisualLayout(layout).ok).toBe(true);
    const user=userEvent.setup();
    const view=render(<PublicPageView page={pageFromResponse(200,{title:"Home",site:11,blocks:[],metadata:{visual_layout:layout}})} privateMediaBase={surface==="preview"?"/admin/sites/11/media":undefined} viewportWidth={1280}/>);
    expect(getComputedStyle(screen.getByRole("heading",{name:"Home",level:1})).position).not.toBe("absolute");
    expect(screen.getAllByRole("heading",{level:1})).toHaveLength(1);
    expect(screen.getByRole("heading",{name:"Discover research"})).toBeTruthy();
    expect(screen.getByRole("link",{name:"Explore"}).getAttribute("href")).toBe("#research");
    expect(screen.queryByRole("heading",{name:"Campus life"})).toBeNull();
    const next=screen.getByRole("button",{name:"Next slide"});
    next.focus();await user.keyboard("{Enter}");
    expect(screen.getByRole("heading",{name:"Campus life"})).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.queryByRole("heading",{name:"Discover research"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Previous slide"}));
    expect(screen.getByRole("heading",{name:"Discover research"})).toBeTruthy();
    expect(screen.getByRole("img",{name:"Research"}).getAttribute("src")).toContain(surface==="preview"?"/admin/sites/11/media/":"/api/v1/site-context/media/");
    view.unmount();
  });
  it("rejects unsafe presentation values and repeated action identity",()=>{
    const layout=scene();
    const hero=layout.rows[0]!.columns[0]!.children[0]!;
    if(hero.type!=="layout_slider")throw new Error("Fixture contract changed");
    const child=hero.props.items[0]!.children[0]!;
    if(child.type!=="hero_image")throw new Error("Fixture contract changed");
    child.props.actions!.push({...child.props.actions![0]!});
    expect(validateVisualLayout(layout).ok).toBe(false);
    child.props.actions!.pop();
    (layout.rows[0]!.style as Record<string,unknown>).background="url(javascript:alert(1))";
    expect(validateVisualLayout(layout).ok).toBe(false);
  });
});

 it("renders approved hero heading semantics and rejects active style values",()=>{
 const layout=scene();const hero=layout.rows[0].columns[0].children[0];
 if(hero.type!=="layout_slider")throw Error("fixture");const node=hero.props.items[0].children[0];
 if(node.type!=="hero_image")throw Error("fixture");
 Object.assign(node.props,{pattern:"diamonds",panel_tone:"brand_gradient",curve_border:"gold",curve_border_width:8,heading_level:3,heading_size:"xl",heading_weight:"heavy",heading_case:"uppercase",text_align:"center",body_size:"lg"});
 expect(validateVisualLayout(layout).ok).toBe(true);
 const view=render(<PublicPageView page={pageFromResponse(200,{title:"Home",site:11,blocks:[],metadata:{visual_layout:layout}})} viewportWidth={1280}/>);
 expect(view.getByRole("heading",{name:"Discover research",level:3})).toBeTruthy();
 Object.assign(node.props,{heading_color:"url(javascript:alert(1))"});expect(validateVisualLayout(layout).ok).toBe(false);view.unmount();
 });

it("keeps untouched legacy rendering and applies explicitly chosen formatting",()=>{
 const props={asset_id:image,alt:"Campus",title:"Legacy hero"};
 const view=render(<HeroView props={props} siteId={null} width={1280}/>);
 expect(view.container.querySelector("[data-hero-frame]")).toBeNull();
 view.rerender(<HeroView props={{...props,heading_level:3,heading_case:"uppercase",panel_tone:"dark"}} siteId={null} width={1280}/>);
 expect(view.getByRole("heading",{name:"Legacy hero",level:3})).toBeTruthy();
 expect(view.container.querySelector("[data-hero-frame]")).toBeTruthy();view.unmount();
});
for(const layout of ["split","split_reverse"] as const)it(`paints tone behind the curved image in ${layout}`,()=>{
 const view=render(<HeroView props={{asset_id:image,alt:"Campus",title:"Curve",layout,mask:"curve",panel_tone:"dark_gradient",curve_border:"gold"}} siteId={null} width={1280}/>);
 const frame=view.container.querySelector("[data-hero-frame]")!;
 expect(getComputedStyle(frame).backgroundImage).toContain("linear-gradient");
 expect(getComputedStyle(view.getByRole("region",{name:"Slide text and actions"})).backgroundImage).not.toContain("linear-gradient");view.unmount();
});

it("applies custom section and hero colours chosen in the picker",()=>{
 const layout=scene();
 layout.rows[0]!.style={...layout.rows[0]!.style,background:"#112233",text_color:"#abcdef"};
 const slider=layout.rows[0]!.columns[0]!.children[0]!;
 if(slider.type!=="layout_slider")throw new Error("fixture");
 const hero=slider.props.items[0]!.children[0]!;
 if(hero.type!=="hero_image")throw new Error("fixture");
 Object.assign(hero.props,{layout:"split",mask:"curve",panel_tone:"#0a2540",curve_border:"#00ff00",heading_color:"#ff0000"});
 expect(validateVisualLayout(layout).ok).toBe(true);
 const view=render(<PublicPageView page={pageFromResponse(200,{title:"Home",site:11,blocks:[],metadata:{visual_layout:layout}})} viewportWidth={1280}/>);
 const section=view.container.querySelector('[data-node-id="row"]') as HTMLElement;
 expect(getComputedStyle(section).backgroundColor).toBe("rgb(17, 34, 51)");
 expect(getComputedStyle(section).color).toBe("rgb(171, 205, 239)");
 const frame=view.container.querySelector("[data-hero-frame]") as HTMLElement;
 expect(getComputedStyle(frame).backgroundColor).toBe("rgb(10, 37, 64)");
 expect(getComputedStyle(frame.firstElementChild as HTMLElement).backgroundColor).toBe("rgb(0, 255, 0)");
 expect(getComputedStyle(view.getByRole("heading",{name:"Discover research"})).color).toBe("rgb(255, 0, 0)");
 expect(getComputedStyle(view.getByRole("region",{name:"Slide text and actions"})).color).toBe("rgb(255, 255, 255)");
 view.unmount();
});

it("chooses readable ink for a light custom panel tone",()=>{
 const view=render(<HeroView props={{asset_id:image,alt:"Campus",title:"Light panel",layout:"split",panel_tone:"#f8edce"}} siteId={null} width={1280}/>);
 expect(getComputedStyle(view.getByRole("region",{name:"Slide text and actions"})).color).toBe("rgb(23, 37, 54)");
 view.unmount();
});

it("renders two linked information cards over a hero without mutating their IDs",()=>{
 const items=[{id:"events",asset_id:image,alt:"Students",eyebrow:"Every campus",title:"Events and activities",text:"Join our community.",label:"View gallery",href:"/gallery"},{id:"sports",asset_id:image,alt:"Sport",title:"Sports festival",text:"Discover campus sport.",label:"Explore sport",href:"/sport"}];
 const view=render(<HeroView props={{asset_id:image,alt:"Campus",title:"Campus life",items,cards_label:"Explore campus",height:"tall"}} siteId={null} width={1280}/>);
 expect(view.getAllByRole("article")).toHaveLength(2);
 expect(view.getByRole("link",{name:"View gallery"}).getAttribute("href")).toBe("/gallery");
 expect(view.container.querySelector('[data-hero-info-card="sports"]')).toBeTruthy();
 expect(view.getByText("Explore campus")).toBeTruthy();view.unmount();
});

it("closes and reopens one hero card by keyboard while preserving focus and the other card",async()=>{
 const items=[{id:"events",asset_id:image,alt:"Students",title:"Events",text:"Community",label:"Gallery",href:"/gallery"},{id:"sport",asset_id:image,alt:"Sport",title:"Sport",text:"Campus",label:"Sport",href:"/sport"}];
 const view=render(<HeroView props={{asset_id:image,alt:"Campus",title:"Life",items}} siteId={null} width={1280}/>);
 const user=userEvent.setup();const close=view.getByRole("button",{name:"Hide Events"});close.focus();await user.keyboard("{Enter}");
 expect(view.queryByRole("link",{name:"Gallery"})).toBeNull();expect(view.getByRole("link",{name:"Sport"})).toBeTruthy();
 const reopen=view.getByRole("button",{name:"Show Events"});expect(document.activeElement).toBe(reopen);expect(reopen.getAttribute("aria-expanded")).toBe("false");
 await user.keyboard(" ");expect(view.getByRole("link",{name:"Gallery"})).toBeTruthy();expect(view.getByRole("button",{name:"Hide Events"}).getAttribute("aria-expanded")).toBe("true");view.unmount();
});
