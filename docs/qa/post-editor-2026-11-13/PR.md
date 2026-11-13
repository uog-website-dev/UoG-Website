Authors previously had to edit Post block JSON and public article output flattened formatting. This change adds a dedicated formatted draft editor on existing Site Post administration and renders the versioned, sanitized article document on the existing public Post route.

The existing Site ownership, UUIDs, revisions, ETags and submit/review/publish workflow remain authoritative. Draft saves preserve revision history, reject stale writes with 409, sanitize server-side and retain unsaved text after failures. A shared allowlisted renderer preserves headings, emphasis, lists, quotations and safe links. Legacy bodies and structured blocks remain readable/editable without bulk conversion.

The only migration joins two existing Sites migration leaves with no operations. Existing public-link/Builder navigation test fixtures were aligned with their current accessible labels and module requirements.

Validation: 29 PostgreSQL API/revision tests, 505 admin tests, 184 shared UI tests, 18 real Keycloak/API checks, real Edge draft/retry/conflict/public-rendering checks, mobile accessibility scan, workspace TypeScript and both production builds. OpenAPI regenerated and validated. See docs/qa/post-editor-2026-11-13/README.md for artifacts and rollout/rollback evidence.

Independent review and Azure DevOps Issue linkage remain pending.
