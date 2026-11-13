import {render,screen,fireEvent} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe,it,expect} from "vitest";
import {validateVisualLayout} from "@uog/types";
import type {VisualLayout} from "@uog/types";
import {PublicPageView,pageFromResponse} from "./public-page";

const image="00000000-0000-4000-8000-000000000001";
function scene():VisualLayout {
  return {schema_version:1,settings:{show_title:false,content_width:"wide"},rows:[{
    id:"row",type:"section",ratios:[100],style:{padding:"md",background:"mist",radius:"lg"},columns:[{
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
    expect(getComputedStyle(screen.getByRole("heading",{name:"Home",level:1})).position).toBe("absolute");
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
