param(
    [Parameter(Mandatory=$true)][string]$PlaywrightRoot,
    [string]$Output = 'docs/qa/module-fixes-2026-11-10'
)
# Run from the repository root against the local writable development stack.
# Credentials travel through stdin only; cleanup runs even after an assertion.
$ErrorActionPreference = 'Stop'
$moduleQaConfig = docker compose config --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read local Compose configuration.' }
$moduleQaInput = $moduleQaConfig.services.'keycloak-init'.environment | ConvertTo-Json -Compress
docker compose cp scripts/qa-module-lifecycle.py backend:/tmp/qa-module-lifecycle.py
if ($LASTEXITCODE -ne 0) { throw 'Could not copy fixture driver.' }
# Never clean up a private session left by a different run implicitly.
docker compose exec -T backend python -c "from pathlib import Path; assert not Path('/tmp/module-lifecycle-session.json').exists(), 'Clean up the previous module lifecycle session first.'"
if ($LASTEXITCODE -ne 0) { throw 'A previous module lifecycle session needs cleanup.' }
$moduleQaSavedRoot = $env:UOG_QA_PLAYWRIGHT_ROOT
$moduleQaSavedOutput = $env:UOG_QA_OUTPUT
try {
    $moduleQaInput | docker compose exec -T backend python /tmp/qa-module-lifecycle.py setup
    if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed.' }
    $env:UOG_QA_PLAYWRIGHT_ROOT = $PlaywrightRoot
    $env:UOG_QA_OUTPUT = $Output
    docker compose exec -T backend cat /tmp/module-lifecycle-session.json | node scripts/qa-module-lifecycle-browser.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Browser lifecycle failed; see the evidence directory.' }
} finally {
    $moduleQaInput | docker compose exec -T backend python /tmp/qa-module-lifecycle.py cleanup
    $moduleQaCleanupFailed = $LASTEXITCODE -ne 0
    $env:UOG_QA_PLAYWRIGHT_ROOT = $moduleQaSavedRoot
    $env:UOG_QA_OUTPUT = $moduleQaSavedOutput
    if ($moduleQaCleanupFailed) { throw 'QA cleanup failed; retry cleanup before another run.' }
}
