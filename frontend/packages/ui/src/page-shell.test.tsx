import { render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { pageFromResponse,PublicPageView } from "./public-page";
afterEach(()=>vi.unstubAllGlobals());
const body={id:"page",site:11,status:"PUBLISHED",title:"University information",path:"/information",blocks:[{type:"paragraph",html:"<p>Existing content</p>"}],seo:{}};
it("defaults legacy and unknown layouts to a full-width shell",()=>{
 const view=render(<PublicPageView page={pageFromResponse(200,body)} />);
 expect(screen.queryByRole('complementary')).toBeNull();
 expect(document.querySelector('[data-page-layout="FULL_WIDTH"]')).toBeTruthy();
 view.rerender(<PublicPageView page={pageFromResponse(200,{...body,layout:'<script>'})} />);
 expect(screen.getByText('Existing content')).toBeTruthy();
 expect(screen.queryByRole('complementary')).toBeNull();
});
it.each(['LEFT_SIDEBAR','RIGHT_SIDEBAR'])("renders %s without altering content and scopes published navigation",async layout=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({results:[{...body,id:'related',path:'/related',title:'Related page'}]})}));
 render(<PublicPageView page={pageFromResponse(200,{...body,layout})} />);
 expect(screen.getByText('Existing content')).toBeTruthy();
 expect(screen.getByRole('complementary',{name:'Page navigation'})).toBeTruthy();
 expect((await screen.findByRole('link',{name:'Related page'})).getAttribute('href')).toBe('/related');
 const article=document.querySelector('article')!;const aside=screen.getByRole('complementary');
 expect(article.compareDocumentPosition(aside)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("ignores foreign sidebar data and keeps the body usable on failure",async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({results:[{...body,site:99,path:'/private',title:'Foreign secret'}]})}));
 render(<PublicPageView page={pageFromResponse(200,{...body,layout:'LEFT_SIDEBAR'})} />);
 await screen.findByText('Other page links are unavailable.');
 expect(screen.queryByText('Foreign secret')).toBeNull();expect(screen.getByText('Existing content')).toBeTruthy();
});
it("private preview does not query the admin hostname for public navigation",()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 render(<PublicPageView page={pageFromResponse(200,{...body,layout:'RIGHT_SIDEBAR'})} privateMediaBase="/admin/sites/11/media" viewportWidth={390} />);
 expect(fetch).not.toHaveBeenCalled();expect(screen.getByText('Published page navigation')).toBeTruthy();
});
