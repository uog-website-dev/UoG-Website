import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import fixtures from "../../types/src/layout/fixtures.json";
import {validateVisualLayout} from "@uog/types";
import {VisualLayoutView} from "./visual-layout";

/** Instrumentation passes when evidence is complete, not when providers work.
 * The release orchestrator gates separately on the required runtime outcomes. */
describe("Sprint 3 renderer capability evidence",()=>{
  it("records actual output for every catalog fixture without substituting providers",()=>{
    const required=new Set(["contact_form","loop_grid","taxonomy_filter","site_logo","site_title","post_title","post_excerpt","featured_image"]);
    const rows=fixtures.filter(value=>value.name.startsWith("catalog-")).map(value=>{
      const type=value.name.slice("catalog-".length);
      const checked=validateVisualLayout(value.layout);
      expect(checked.ok).toBe(true);
      if(!checked.ok)throw new Error("Invalid catalog fixture");
      const html=renderToStaticMarkup(<VisualLayoutView layout={checked.value} siteId={11} pageTitle="Sprint 3 review"/>);
      const fallback=html.includes('data-fallback="integration"');
      return {type,fixture:value.name,contract:"PASS",rendered_html_sha256:createHash("sha256").update(html).digest("hex"),
        integration_fallback:fallback,contains_form:html.includes("<form"),
        required_runtime:required.has(type),runtime_status:fallback?"UNAVAILABLE":"MARKUP_ONLY",
        release_status:required.has(type)?(fallback?"FAIL":"NOT_VERIFIED_WITH_PROVIDER"):"CONTRACT_ONLY"};
    });
    expect(rows).toHaveLength(43);
    const evidence={scope:"actual shared React renderer output; static markup is not provider integration or browser E2E",widgets:rows,
      required_runtime_failures:rows.filter(row=>row.required_runtime && row.integration_fallback).map(row=>row.type),
      provider_credentials_or_bindings_substituted:false};
    if(process.env.SPRINT3_EVIDENCE_FILE)writeFileSync(process.env.SPRINT3_EVIDENCE_FILE,JSON.stringify(evidence,null,2)+"\n");
  });
});
