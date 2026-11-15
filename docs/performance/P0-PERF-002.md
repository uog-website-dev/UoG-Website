# P0-PERF-002: single scoped workspace bootstrap

The administration shell owns one `WorkspaceProvider`. Desktop navigation, mobile navigation and the active Site frame consume that provider. Site administration layouts no longer fetch Site details, organization details, effective permissions or module assignments separately. The console landing page also consumes the shared context instead of enumerating every Site. Existing domain-management and registry screens retain their explicit listing APIs.

## API contract

`GET /api/workspace/?site=<positive safe integer>` requires a Keycloak bearer token. Omitting `site` returns only platform-scoped permissions and `site: null`. A selected Site requires the live `sites.view` capability at its resolved owning organization/Site scope. Missing and unauthorized Sites both return the same 404 shape. Invalid, duplicate and unknown parameters return 400. Authentication failures return 401. Failures never become a successful empty context.

The versioned response is:

```json
{
  "schemaVersion": 1,
  "version": "sha256-of-authorized-context",
  "platformPermissions": [],
  "site": {
    "id": 81,
    "name": "Performance Site 01",
    "code": "PERF001-01",
    "status": "ACTIVE",
    "organization": {"id": 10, "name": "Owning organization"},
    "defaultLanguage": "en-us",
    "enabledLanguages": ["en-us"],
    "primaryDomain": null,
    "homepageId": null,
    "permissions": ["sites.view", "content.pages.view"],
    "enabledModuleCodes": ["PAGES"]
  }
}
```

Only an owning organization's ID/name is included as Site identity context; its directory/configuration is not exposed. No full Site list or module configuration is returned. Module codes use the existing shipped/global/Site/transitive-dependency selector. The organization is resolved from the Site, never a client-supplied owner parameter.

The content version and strong ETag identify this representation. Responses are `private, no-store`, vary by authorization/cookie, and always revalidate access; `If-None-Match` never bypasses authorization or produces 304. Permissions are derived from a live database snapshot with active registered capabilities, active users/roles, expiry, revocation, scope inheritance and the existing explicit platform-administrator bypass. No persistent permission cache is introduced. The single-permission authorization service remains authoritative for protected operations.

`GET /api/workspace/sites/?search=<name-or-code>&page=1&page_size=20` is separate discovery. It returns `{count, page, page_size, results: [{id, name, code, status}]}` for authorized Sites only. Ordering is name then stable ID; maximum page size is 50, search length 100 and page 1,000,000. Invalid/ambiguous/unknown parameters return 400. An empty or out-of-range positive page returns an empty results array. Search is a literal case-insensitive name/code substring. The UI loads this endpoint only when Workspace is opened or its search/pagination/retry changes, with debounced search and cancellation. Changing Site closes the dialog and resets its query state.

The Next routes `/admin/api/workspace/` and `/admin/api/workspace/sites/` each proxy exactly one corresponding Django request. Session credentials remain server-side. Network/invalid-upstream failures return a generic 502 without private exception text. OpenAPI definitions and bounded parameter schemas are in [the API baseline](../api/openapi.yaml).

## Lifecycle and recovery

Direct links and refresh initialize the provider for the URL's Site. A Site change immediately removes the previous Site context, aborts the old fetch, and ignores a late result even if transport cancellation fails. Responses must match the requested Site and supported schema before being used. Same-Site section navigation reuses context and makes no bootstrap request. Concurrent consumers share the provider's single request.

Window focus and explicit `refreshWorkspace()` revalidate live context. Successful same-Site revalidation keeps editors mounted so unsaved content survives; failure hides privileged content and offers retry. Invalid or mismatched responses fail closed. A 401 invokes the existing session-expiry flow. An expired/revoked membership is rejected by every backend operation even before client revalidation. Context is advisory UI state, never an authorization credential. No cross-user/global client cache is used.

No database migration or new permission grant is required. Deploy the updated backend and rebuilt admin together; old/new workspace representations are intentionally not silently mixed. The shared provider rejects a stale schema rather than rendering misleading controls.

## Measurement and approval

Use the same PERF-001 dataset and production profile, then run `scripts/perf/run.ps1 -Mode production -Samples 10 -Output docs/qa/P0-PERF-002/local`. The harness now opens the real searchable Workspace dialog and includes discovery in Site-switch latency. This interaction change is disclosed when comparing with the original native selector. Direct workspace API timings use the same endpoint and are directly comparable at the contract boundary. Other shared-host conditions and sampling limitations from [PERF-001](P0-PERF-001.md) apply.

The original proposed workspace API p95 target is 500 ms. All budgets and methodology remain **PROPOSED until product/QA accepts them**; this implementation cannot claim an approved budget or external sign-off. See [local evidence](../qa/P0-PERF-002/2026-11-15/README.md) for measured changes, regression results and outstanding acceptance.
