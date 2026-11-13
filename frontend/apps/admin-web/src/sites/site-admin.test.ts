import { describe, expect, it } from "vitest";

import {
  accessibleSiteOptions,
  canActivateCentralModules,
  enabledModuleCodes,
  sectionByKey,
  sectionDecision,
  isSiteSectionActive,
  siteSwitchHref,
  visibleSiteSections,
} from "./site-admin";

const editor = {
  enabledModuleCodes: ["PAGES", "MENUS"],
  permissions: ["content.pages.view", "menu.read"],
};

describe("site administration matrix", () => {
  it("shows Visual Builder only when VISUAL_BUILDER is enabled for Page editors",()=>{
    const builder=sectionByKey("builder");
    expect(sectionDecision(builder,{enabledModuleCodes:["VISUAL_BUILDER"],permissions:["content.pages.update"]})).toBe("visible");
    expect(sectionDecision(builder,{enabledModuleCodes:["PAGES"],permissions:["content.pages.update"]})).toBe("module_disabled");
    expect(sectionDecision(builder,{enabledModuleCodes:["VISUAL_BUILDER"],permissions:["content.pages.view"]})).toBe("permission_denied");
    expect(sectionDecision(builder,{enabledModuleCodes:[],permissions:["content.pages.update"]})).toBe("module_disabled");
    expect(isSiteSectionActive(builder,11,"/sites/11/admin/builder")).toBe(true);
    expect(isSiteSectionActive(builder,11,"/sites/11/admin/pages/page-id/builder")).toBe(true);
    expect(isSiteSectionActive(sectionByKey("pages"),11,"/sites/11/admin/pages/page-id/builder")).toBe(false);
    expect(isSiteSectionActive(builder,11,"/sites/22/admin/builder")).toBe(false);
  });
  it("shows Pages and Menus only when the module is enabled and the user is permitted", () => {
    expect(visibleSiteSections(editor).map((section) => section.key)).toEqual([
      "dashboard",
      "pages",
      "menus",
    ]);
  });

  it("shows Homepage Settings for Site administrators when PAGES is enabled", () => {
    const homepage = sectionByKey("homepage");
    expect(sectionDecision(homepage, {
      enabledModuleCodes: ["PAGES"],
      permissions: ["sites.update"],
    })).toBe("visible");
    expect(sectionDecision(homepage, editor)).toBe("permission_denied");
    expect(sectionDecision(homepage, {
      enabledModuleCodes: [],
      permissions: ["sites.update"],
    })).toBe("module_disabled");
    expect(isSiteSectionActive(homepage, 11, "/sites/11/admin/homepage")).toBe(true);
    expect(isSiteSectionActive(homepage, 22, "/sites/11/admin/homepage")).toBe(false);
  });

  it("shows Media for a Site Editor when MEDIA is enabled and content.media.view is granted", () => {
    expect(sectionDecision(sectionByKey("media"), {
      enabledModuleCodes: ["MEDIA"],
      permissions: ["content.media.view", "content.media.upload"],
    })).toBe("visible");
    expect(sectionDecision(sectionByKey("media"), {
      enabledModuleCodes: ["PAGES"],
      permissions: ["content.media.view"],
    })).toBe("module_disabled");
    expect(sectionDecision(sectionByKey("media"), {
      enabledModuleCodes: ["MEDIA"],
      permissions: ["content.pages.view"],
    })).toBe("permission_denied");
  });

  it("shows the Users section without a content module when site user access is granted", () => {
    expect(visibleSiteSections({ enabledModuleCodes: [], permissions: ["platform.users.view"] }).map((section) => section.key)).toEqual(["dashboard", "users"]);
    expect(sectionDecision(sectionByKey("users"), { enabledModuleCodes: [], permissions: [] })).toBe("permission_denied");
  });

  it("hides a section when the Site module is off", () => {
    expect(sectionDecision(sectionByKey("pages"), {
      enabledModuleCodes: ["MENUS"],
      permissions: ["content.pages.update"],
    })).toBe("module_disabled");
    expect(sectionDecision(sectionByKey("posts"), editor)).toBe("module_disabled");
  });

  it("hides a section when the user lacks that permission", () => {
    expect(sectionDecision(sectionByKey("menus"), {
      enabledModuleCodes: ["MENUS"],
      permissions: ["content.pages.view"],
    })).toBe("permission_denied");
  });

  it("does not treat another Site's module row as enabled here", () => {
    expect(enabledModuleCodes([
      { site: 22, is_enabled: true, module_code: "PAGES" },
      { site: 11, is_enabled: false, module_code: "PAGES" },
      { site: 11, is_enabled: true, module_code: "MENUS" },
    ], 11)).toEqual(["MENUS"]);
  });

  it("hides globally disabled or unshipped modules even when the Site switch is on", () => {
    expect(enabledModuleCodes([
      { site: 11, is_enabled: true, is_available: false, module_code: "POSTS" },
      { site: 11, is_enabled: true, is_available: true, module_code: "PAGES" },
      { site: 11, is_enabled: false, is_available: false, module_code: "MENUS" },
    ], 11)).toEqual(["PAGES"]);
  });

  it("lists each accessible Site once and drops an invalid id", () => {
    expect(accessibleSiteOptions([
      { id: 11, name: "Informatics" },
      { id: 11, name: "Informatics again" },
      { id: 0, name: "Missing" },
      { id: 22, name: "Medicine" },
    ]).map((site) => site.id)).toEqual([11, 22]);
  });

  it("sends a Site switch to that Site's dashboard", () => {
    expect(siteSwitchHref(22)).toBe("/sites/22/admin");
    expect(siteSwitchHref(22)).not.toContain("/pages");
  });

  it("keeps central module activation off the Site menu unless delegated", () => {
    expect(canActivateCentralModules(editor.permissions)).toBe(false);
    expect(canActivateCentralModules(["platform.sites.manage_registry"])).toBe(true);
  });
});
