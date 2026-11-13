# Current versus historical Sprint 3 evidence

The [Visual Builder remediation addendum](../visual-builder-remediation-2026-11-12/README.md)
records subsequent fixes for the eight required widget runtimes, admin TypeScript/build
errors and OpenAPI baseline mismatch. Its local verification includes a successful
100-check real-service run. Browser walkthrough, hosted CI and reviewer signatures
remain pending release evidence.

The earlier `CONDITIONAL GO` report was based on protocol tests which used
`force_authenticate`, in-memory storage and direct processing calls. Merely
finding Compose services running did not make that path a real-service E2E run.
The old report and orchestrator are preserved in
[historical-previous-review](historical-previous-review/); their acceptance
claims are superseded and must not be used to approve the release.

Use [release-audit/report.md](release-audit/report.md) for the current assessment,
[release-audit/live-services.json](release-audit/live-services.json) for actual
real-service requests, and [release-audit/manifest.json](release-audit/manifest.json)
for integrity checks. An integrity hash is not a person's approval signature.

Repeat from the repository root:

```powershell
python scripts/sprint3-review.py --live --build
```

The command intentionally exits **2** when Sprint acceptance remains blocked,
even if its test commands pass. It never assigns a stakeholder name or waives
missing browser/provider/CI evidence. `--live` explicitly authorizes creating
isolated review Sites and scoped Keycloak profiles. It requires the development
Compose stack and configured root `.env` credentials, which are never stored in
the evidence. Global modules must already be implemented and enabled: the harness
does not turn global capabilities on for unrelated Sites.

Use `--output docs/qa/sprint3-review-2026-11-12/run-02` for subsequent runs to
retain earlier evidence. Generated `signoff.json` is an unsigned template, not
a storage location for a person's signed record; keep signed copies separately
and bind them to the final source hash and artifact manifest.

It retains the review Sites, published snapshots and audit history, disables its
generated Keycloak identities and deactivates their local accounts. Every Site,
profile and asset ID is listed in the live result. Original files stay private.
The first live attempt incorrectly compared Medicine's generation after deleting
a Medicine asset; that changed generation legitimately. Its failed result is
retained in [live-release/attempts](live-release/attempts/). The corrected fixture
finishes peer-Site setup before the isolation baseline and performs later
destructive checks only on the review's Informatics Site.

Builds operate on temporary source copies, preserving the running Next.js dev
output. Logs identify commands, exit codes, JUnit outcomes and the exact dirty
working-tree source hash. No source commit or push is performed. A hosted CI run
must match that source state before it can be accepted as release evidence.
