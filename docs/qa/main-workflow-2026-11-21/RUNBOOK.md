# Repeating the Main Site workflow

Use a development database and real configured services. This intentionally publishes review content to the **existing Main Site** and changes its homepage/menu assignments; do not run on production. The setup requires DEBUG and verifies the existing MAIN identity, active roles and shipped modules. Review current assignments before running. Use the ordinary platform administrator tools for final content cleanup/restoration; never archive the Main Site.

1. Start the normal Compose dependencies (Django, PostgreSQL, Keycloak, Redis, MinIO, Celery, both frontends and nginx), apply required existing migrations and verify health.
2. Ensure the existing Main Site has an active primary development domain. The browser driver maps `*.uog.local` to loopback. For interactive review configure local DNS/hosts accordingly. Keycloak redirect/client configuration must match the existing admin deployment.
3. Copy `scripts/sprint3_live_review.py`, `scripts/qa-main-workflow-setup.py` and `scripts/qa-main-workflow-session.py` to backend `/tmp/`. These are prerequisites/authentication helpers; only the browser creates editorial content.
4. Pipe the local environment configuration into the setup through stdin. Keep its private `/tmp/main-workflow-session.json` on the backend; never log/attach it. Setup journals partially provisioned users for recovery, creates separate Site-only profiles and generates `/tmp/main-workflow-campus.png`.
5. Copy that PNG to `.git/task-data/main-workflow-campus.png`. Install the pinned Playwright dependency from `scripts/perf/package-lock.json` using `npm ci --prefix scripts/perf` if absent. The default browser is Microsoft Edge; `UOG_QA_BROWSER` can select an installed compatible Chromium executable.
6. Set `UOG_QA_OUTPUT` to a **new** evidence directory. Refresh the private session through `qa-main-workflow-session.py` and pipe its stdout directly into `node scripts/qa-main-workflow-browser.cjs all`. Never tee or save that credential-bearing stream. Stages `media`, `menus`, `article`, `page`, `homepage`, `restore`, `negative` and `public` allow resumable evidence collection using the same private journal and progress file. The driver refuses a mismatched run ID.
7. Collect bounded test/build evidence separately; use `frontend/scripts/isolated-production-build.mjs` so production compilation does not overwrite live development `.next` files. Run public production build in that isolated checkout. Record versions, source commit/hashes and actual exit codes. No timing budget is inferred from a development browser walkthrough.
8. Inspect screenshots and HTTP status traces, reconcile workflow actors/approved revisions/assignments read-only, and scan artifacts for secrets. Keep failed attempts explicitly labeled; do not turn retries into a fabricated first-pass run.
9. Copy and run `scripts/qa-main-workflow-cleanup.py` with private configuration through stdin. It verifies the generated identity prefix and Main scope, disables only generated Keycloak/Django identities, revokes their memberships and removes the private journal. It retains Site-owned published content and Main activity. If it fails, retain the journal and resolve/retry; do not discard recovery identifiers.
10. Rerun the anonymous `public` stage with only public `{run, site, host}` input and the same output directory. This stage does not require account credentials. For the captured run, `public-targets.json` provides that input. Confirm retained content still renders after generated creator accounts are disabled.
11. Attach the resulting report, screenshots, JUnit, trace and source manifest to the actual Issue/PR. Obtain human approval; repository artifacts alone are not sign-off.

PowerShell private configuration pattern (do not echo the variable or session):

```powershell
$qaConfig = @{}
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $qaConfig[$matches[1]] = $matches[2].Trim('"') }
}
$qaConfig | ConvertTo-Json |
  docker compose exec -T backend python manage.py shell -c "exec(open('/tmp/qa-main-workflow-session.py',encoding='utf-8-sig').read())" |
  node scripts/qa-main-workflow-browser.cjs all
```

The Main review uses ordinary published routes `/`, `/posts`, `/posts/{slug}` and `/{page-slug}`. Header/footer/sidebar use separate same-Site menus. A reused template contains starter text until edited; no provider-dependent newsletter/chat integration is implied by this workflow.
