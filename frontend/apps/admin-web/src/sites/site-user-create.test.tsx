import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const create=vi.fn();
const assign=vi.fn();
const existingSearch=vi.fn();
vi.mock("@/app/sites/user-actions",()=>({
  createSiteUser:(...args:unknown[])=>create(...args),
  assignSiteRole:(...args:unknown[])=>assign(...args),
  searchSiteUsers:(...args:unknown[])=>existingSearch(...args),
  getSiteRoles:async()=>roles,
  getSiteUsers:async()=>({results:[],count:0}),revokeSiteRole:vi.fn(),
}));
vi.mock("next/navigation",()=>({useParams:()=>({id:"11"})}));
vi.mock("@/sites/site-admin-frame",()=>({SiteSection:({children}:{children:React.ReactNode})=>children,useSiteAdmin:()=>({site:{id:11,name:"Informatics",organizationId:7}})}));
import { SiteUserCreate } from "./site-user-create";
import SiteUsersPage from "../app/sites/[id]/admin/users/page";
const roles=[{id:2,code:"editor",name:"Editor",permissions:[],assignable:true},{id:3,code:"platform-administrator",name:"Platform Administrator",permissions:[],assignable:true}];
beforeEach(()=>{vi.clearAllMocks();create.mockResolvedValue({ok:true,username:"new.staff"});assign.mockResolvedValue({});});
function form(onCreated=vi.fn()) {
 render(<SiteUserCreate siteId={11} siteName="Informatics" roles={roles} onClose={vi.fn()} onCreated={onCreated} />);
 fireEvent.change(screen.getByRole("textbox",{name:/^Username/}),{target:{value:"new.staff"}});
 fireEvent.change(screen.getByRole("textbox",{name:/^Email/}),{target:{value:"new@example.edu"}});
 fireEvent.change(screen.getByLabelText(/^Password/),{target:{value:"Campus!57832"}});
 fireEvent.change(screen.getByLabelText(/^Confirm password/),{target:{value:"Campus!57832"}});
 return onCreated;
}
async function role() {
 fireEvent.mouseDown(screen.getByRole("combobox",{name:/Site role/}));
 expect(screen.queryByRole("option",{name:"Platform Administrator"})).toBeNull();
 fireEvent.click(await screen.findByRole("option",{name:"Editor"}));
}
it("requires a Site role before calling the server",async()=>{
 form();fireEvent.submit(document.querySelector("form")!);
 expect(await screen.findByText("Choose a Site role.")).toBeTruthy();expect(create).not.toHaveBeenCalled();
});
it("creates with explicit Site role and optional picture omitted",async()=>{
 const done=form();await role();fireEvent.submit(document.querySelector("form")!);
 await waitFor(()=>expect(done).toHaveBeenCalledWith("new.staff"));
 expect(create.mock.calls[0][0]).toBe(11);
 expect(create.mock.calls[0][1].get("role")).toBe("2");
});
it("preserves inputs and focuses the field on recoverable rejection",async()=>{
 create.mockResolvedValue({ok:false,message:"Check the highlighted fields.",errors:{email:"This email already exists."}});
 form();await role();fireEvent.submit(document.querySelector("form")!);
 expect(await screen.findByText("This email already exists.")).toBeTruthy();
 expect((screen.getByRole("textbox",{name:/^Username/}) as HTMLInputElement).value).toBe("new.staff");
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("textbox",{name:/^Email/})));
});
it("rejects password mismatch without submitting",async()=>{
 form();await role();fireEvent.change(screen.getByLabelText(/^Confirm password/),{target:{value:"different"}});fireEvent.submit(document.querySelector("form")!);
 expect(await screen.findByText("Passwords do not match.")).toBeTruthy();expect(create).not.toHaveBeenCalled();
});
it("retains existing-user search and Site-only assignment flow",async()=>{
 existingSearch.mockResolvedValue([{id:55,username:"existing.staff",email:"existing@example.edu",first_name:"Existing",last_name:"Staff",assigned_role_ids:[]}]);
 render(<SiteUsersPage />);
 fireEvent.click(await screen.findByRole("button",{name:"Add existing user"}));
 fireEvent.focus(screen.getByRole("combobox",{name:"Search platform users"}));
 fireEvent.change(screen.getByRole("combobox",{name:"Search platform users"}),{target:{value:"existing"}});
 fireEvent.click(await screen.findByRole("option",{name:/Existing Staff/}));
 await role();fireEvent.click(screen.getByRole("button",{name:"Add user"}));
 await waitFor(()=>expect(assign).toHaveBeenCalledWith(11,7,55,2));
});
