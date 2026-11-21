param([string]$Output="docs/qa/P0-PERF-010/local")
$ErrorActionPreference="Stop"
New-Item -ItemType Directory -Force $Output | Out-Null
$privateConfig=@{}
Get-Content .env | ForEach-Object {if($_ -match '^([^#=]+)=(.*)$'){$privateConfig[$matches[1]]=$matches[2].Trim('"')}}
$env:PERF_OUTPUT=$Output
$checks=@(
 @{Script='workspace-check.cjs';Variable='PERF_CHECK_OUTPUT';File='workspace.json'},
 @{Script='site-switch-check.cjs';Variable='PERF_SWITCH_CHECK_OUTPUT';File='switch.json'},
 @{Script='section-check.cjs';Variable='PERF_SECTION_CHECK_OUTPUT';File='sections.json'},
 @{Script='cache-check.cjs';Variable='PERF_CACHE_CHECK_OUTPUT';File='cache.json'},
 @{Script='dashboard-check.cjs';Variable='PERF_DASHBOARD_CHECK_OUTPUT';File='dashboard.json'},
 @{Script='read-check.cjs';File='browser-reads.json'},
 @{Script='recovery-check.cjs';File='recovery.json'},
 @{Script='isolation-check.cjs';File='isolation.json'}
)
$results=@()
foreach($check in $checks){
 if($check.Variable){[Environment]::SetEnvironmentVariable($check.Variable,"$Output/$($check.File)",'Process')}
 # Session helper stdout contains credentials: pipe directly; never tee or persist it.
 $privateConfig|ConvertTo-Json|docker compose exec -T backend python manage.py shell -c "exec(open('/tmp/prepare-session.py').read())"|node "scripts/perf/$($check.Script)"
 $results+=@{script=$check.Script;exit_code=$LASTEXITCODE;evidence=$check.File}
 if($check.Variable){[Environment]::SetEnvironmentVariable($check.Variable,$null,'Process')}
}
$results|ConvertTo-Json|Set-Content -Encoding utf8 "$Output/suite.json"
if(@($results|Where-Object {$_.exit_code -ne 0}).Count){throw 'Release browser suite failed; inspect redacted evidence'}
