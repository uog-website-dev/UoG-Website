param(
    [ValidateSet('prepare','workflow','extras','probes','browser','module-off','module-on','persistence','cleanup','fresh-start','fresh-stop','status')]
    [string]$Phase,
    [ValidateSet('existing','fresh')][string]$Environment = 'existing',
    [string]$BrowserMode = 'full',
    [ValidatePattern('^[a-z0-9-]+$')][string]$RunLabel = '20261104',
    [ValidatePattern('^[a-z0-9-]+$')][string]$EvidenceName = 'rerun-2026-11-04'
)
# Local acceptance harness. Resolved Compose secrets remain outside the repository.
# Run from the repository root. Existing developer volumes are never removed.
$ErrorActionPreference = 'Stop'
$qaDate = '2026-11-04'
$qaRoot = Join-Path (Get-Location) "docs/qa/P2-QA-GATE-001/evidence/$EvidenceName"
$qaOut = Join-Path $qaRoot $Environment
New-Item -ItemType Directory -Force $qaOut | Out-Null
$qaTemp = Join-Path $env:TEMP "uog-qa-gate-$RunLabel"
$qaProject = "uog-gate-$RunLabel"
New-Item -ItemType Directory -Force $qaTemp | Out-Null
$qaFreshFile = Join-Path $qaTemp 'fresh.json'
$qaOverride = Join-Path $qaTemp 'existing.json'
$qaSavedDebug = $env:DEBUG
Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
try {
    $qaBase = docker compose config --format json | ConvertFrom-Json
    $qaBuild = git rev-parse HEAD
    $qaDelta = (git diff HEAD -- backend frontend | Out-String)
    if ($qaDelta.Trim()) {
        $qaHash = [System.Security.Cryptography.SHA256]::Create()
        try { $qaFingerprint = [BitConverter]::ToString($qaHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($qaDelta))).Replace('-','').ToLower() }
        finally { $qaHash.Dispose() }
        $qaBuild += '+worktree.' + $qaFingerprint.Substring(0,12)
    }
    $qaInput = @{kc=$qaBase.services.'keycloak-init'.environment; build=$qaBuild; date=$qaDate} | ConvertTo-Json -Depth 10 -Compress
    $qaArgs = @('-f','docker-compose.yml')
    if ($Environment -eq 'fresh') { $qaArgs = @('-p',$qaProject,'-f',$qaFreshFile) }
    function Invoke-QaCompose {
        & docker compose @qaArgs @args
        if ($LASTEXITCODE -ne 0) { throw "Compose operation failed ($LASTEXITCODE)." }
    }
    function Invoke-QaDriver([string[]]$DriverArgs) {
        $qaInput | & docker compose @qaArgs exec -T backend python /tmp/qa-gate-rerun.py @DriverArgs
        if ($LASTEXITCODE -ne 0) { throw 'Acceptance workflow failed; preserve partial results and run cleanup.' }
    }
    switch ($Phase) {
        'prepare' {
            @{services=@{backend=@{environment=@{DEBUG='True'; ORGANIZATIONS_DEV_WRITES_ENABLED='True'}}}} |
                ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $qaOverride
            & docker compose -f docker-compose.yml -f $qaOverride up -d --no-deps backend
            if ($LASTEXITCODE -ne 0) { throw 'Backend preparation failed.' }
            Invoke-QaCompose restart nginx
        }
        'fresh-start' {
            if (Test-Path $qaFreshFile) { throw 'Fresh configuration already exists; inspect before reusing it.' }
            $qaBase.name = $qaProject
            foreach ($qaService in $qaBase.services.PSObject.Properties) {
                $qaService.Value.PSObject.Properties.Remove('container_name')
                if ($qaService.Value.environment -and $qaService.Value.environment.PSObject.Properties['DEBUG']) {
                    $qaService.Value.environment.DEBUG = 'True'
                    $qaService.Value.environment.ORGANIZATIONS_DEV_WRITES_ENABLED = 'True'
                }
            }
            foreach ($qaResource in @('volumes','networks')) {
                foreach ($qaEntry in $qaBase.$qaResource.PSObject.Properties) {
                    $qaEntry.Value.name = $qaProject + '_' + $qaEntry.Name
                }
            }
            $qaBase | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 $qaFreshFile
            & docker compose stop
            if ($LASTEXITCODE -ne 0) { throw 'Existing stack did not stop cleanly.' }
            $qaArgs = @('-p',$qaProject,'-f',$qaFreshFile)
            Invoke-QaCompose up -d --no-build
        }
        'fresh-stop' {
            # Remove only this dedicated QA project's containers. Keep QA volumes
            # available for inspection; never use down -v against developer data.
            Invoke-QaCompose down
            Remove-Item -LiteralPath $qaFreshFile
            & docker compose up -d --no-build
            if ($LASTEXITCODE -ne 0) { throw 'Existing stack restoration failed.' }
        }
        'workflow' {
            Invoke-QaCompose cp scripts/qa-gate-wait.py backend:/tmp/qa-gate-wait.py
            Invoke-QaCompose exec -T backend python /tmp/qa-gate-wait.py
            Invoke-QaCompose cp scripts/qa-gate-rerun.py backend:/tmp/qa-gate-rerun.py
            Invoke-QaDriver @()
        }
        'extras' { Invoke-QaDriver @('--extras') }
        'probes' {
            Invoke-QaCompose cp scripts/qa-gate-probes.py backend:/tmp/qa-gate-probes.py
            $qaInput | & docker compose @qaArgs exec -T backend python /tmp/qa-gate-probes.py
            $qaProbeExit = $LASTEXITCODE
            Invoke-QaCompose cp backend:/tmp/qa-gate-results.json (Join-Path $qaOut 'api-results.json')
            Invoke-QaCompose cp backend:/tmp/qa-gate-requests.json (Join-Path $qaOut 'http-transcript.json')
            if ($qaProbeExit -ne 0) { throw 'Additional HTTP acceptance probes failed; results were preserved.' }
        }
        'persistence' {
            Invoke-QaCompose cp scripts/qa-gate-wait.py backend:/tmp/qa-gate-wait.py
            Invoke-QaCompose exec -T backend python /tmp/qa-gate-wait.py
            Invoke-QaDriver @('--persistence')
        }
        'browser' {
            $env:UOG_QA_PLAYWRIGHT_ROOT = Join-Path $env:TEMP 'uog-qa-browser/node_modules/playwright-core'
            $env:UOG_QA_OUTPUT = $qaOut
            $env:UOG_QA_MODE = $BrowserMode
            $qaRead = "import json; from pathlib import Path; print(json.dumps({'session':json.loads(Path('/tmp/qa-gate-session.json').read_text()),'state':json.loads(Path('/tmp/qa-gate-results.json').read_text())['state']}))"
            & docker compose @qaArgs exec -T backend python -c $qaRead | node scripts/qa-gate-browser.cjs
            if ($LASTEXITCODE -ne 0) { throw 'Browser acceptance assertions failed; see current evidence.' }
        }
        {$_ -in 'module-off','module-on'} {
            # Reuse the authenticated HTTP helpers without executing another workflow.
            $qaOperation = if ($Phase -eq 'module-off') {'disable'} else {'enable'}
            $qaProgram = @'
import sys
from pathlib import Path
source=Path('/tmp/qa-gate-rerun.py').read_text().split('\ntry:\n    if set(sys.argv)')[0]
exec(compile(source,'qa-http-helpers','exec'))
previous=json.loads(Path('/tmp/qa-gate-results.json').read_text())
state,results=previous['state'],previous['results']
events=json.loads(Path('/tmp/qa-gate-requests.json').read_text())
run=state['run']
actors.update(json.loads(secret_path.read_text())['actors'])
principal=actors['admin']
fresh=http('http://keycloak:8080/realms/uog/protocol/openid-connect/token','POST',form={'grant_type':'password','client_id':'backend-api','client_secret':env['KEYCLOAK_BACKEND_API_SECRET'],'username':principal['username'],'password':principal['password']})
assert fresh[0]==200
principal.update(fresh[1])
site=state['sites'][0]
action(site['url']+f"modules/{site['module_ids']['MENUS']}/",'OPERATION')
if 'OPERATION'=='enable':
    for pk,value in state.get('restore_global_modules',{}).items():
        patch(f'/api/v1/modules/{pk}/',{'is_enabled':value})
    state['global_flags_restored_via_api']=True
save()
print('MENUS OPERATION via management API; global flags restored on enable.')
'@
            $qaProgram = $qaProgram.Replace('OPERATION',$qaOperation)
            $qaProgram | & docker compose @qaArgs exec -T backend sh -c 'cat > /tmp/qa-gate-modules.py'
            $qaInput | & docker compose @qaArgs exec -T backend python /tmp/qa-gate-modules.py
            if ($LASTEXITCODE -ne 0) { throw 'Module management API operation failed.' }
        }
        'cleanup' {
            Invoke-QaCompose cp scripts/qa-gate-cleanup.py backend:/tmp/qa-gate-cleanup.py
            $qaInput | & docker compose @qaArgs exec -T backend python /tmp/qa-gate-cleanup.py
            if ($LASTEXITCODE -ne 0) { throw 'QA identity cleanup failed.' }
            Invoke-QaCompose cp backend:/tmp/qa-cleanup.json (Join-Path $qaOut 'cleanup.json')
            if ($Environment -eq 'existing') {
                Invoke-QaCompose up -d --no-deps backend
                Invoke-QaCompose restart nginx
                if (Test-Path $qaOverride) { Remove-Item -LiteralPath $qaOverride }
            }
        }
        'status' {
            Invoke-QaCompose ps --format '{{.Service}} {{.State}} {{.Health}}'
        }
    }
    if ($Phase -in 'workflow','extras','probes','persistence','module-off','module-on') {
        Invoke-QaCompose cp backend:/tmp/qa-gate-results.json (Join-Path $qaOut 'api-results.json')
        Invoke-QaCompose cp backend:/tmp/qa-gate-requests.json (Join-Path $qaOut 'http-transcript.json')
    }
} finally {
    if ($null -ne $qaSavedDebug) { $env:DEBUG = $qaSavedDebug }
}
