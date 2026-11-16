param(
 [ValidateSet("production","development")][string]$Mode="production",
 [ValidateRange(2,100)][int]$Samples=10,
 [ValidateRange(10,30)][int]$Sites=10,
 [string]$Output="docs/qa/P0-PERF-001/local",
 [switch]$SkipSeed,
 [switch]$SectionMatrix,
 [switch]$DashboardProbes
)
$ErrorActionPreference="Stop"
# Run from the repository root. Secrets remain in memory/stdin, never evidence.
$privateConfig=@{}
Get-Content .env | ForEach-Object {if($_ -match '^([^#=]+)=(.*)$'){$privateConfig[$matches[1]]=$matches[2].Trim('"')}}
$privateConfig['PERF_SITES']=$Sites
$compose=@("compose","-f","docker-compose.yml","-f","docker-compose.perf.yml","--profile","performance")
New-Item -ItemType Directory -Force "$Output/$Mode" | Out-Null
foreach($file in @("scripts/sprint3_live_review.py","scripts/perf/seed.py","scripts/perf/prepare-session.py")){
 $name=Split-Path $file -Leaf
 docker compose cp $file "backend:/tmp/$name"
 if($LASTEXITCODE){throw "Cannot install benchmark helper"}
}
if(!$SkipSeed){
 $privateConfig | ConvertTo-Json | docker compose exec -T backend python manage.py shell -c "exec(open('/tmp/seed.py').read())"
 if($LASTEXITCODE){throw "Dataset preparation failed"}
}
$previousMode=$env:PERF_NEXT_MODE
$previousMatrix=$env:PERF_SECTION_MATRIX
$previousDashboard=$env:PERF_DASHBOARD_PROBES
try{
 $env:PERF_NEXT_MODE=$Mode
 docker @compose up -d --no-deps --force-recreate perf-backend perf-admin perf-gateway
 if($LASTEXITCODE){throw "Benchmark services failed to start"}
 $deadline=(Get-Date).AddMinutes(15);$ready=$false
 while((Get-Date) -lt $deadline){
  try{$response=Invoke-WebRequest http://localhost:8088/admin -UseBasicParsing -TimeoutSec 5;if($response.StatusCode -eq 200){$ready=$true;break}}catch{}
  Start-Sleep -Seconds 3
 }
 if(!$ready){throw "Performance frontend did not become ready"}
 $env:PERF_MODE=$Mode;$env:PERF_SAMPLES="$Samples";$env:PERF_OUTPUT="$Output/$Mode";$env:PERF_ORIGIN="http://localhost:8088"
 $env:PERF_SECTION_MATRIX=if($SectionMatrix){'1'}else{'0'}
 $env:PERF_DASHBOARD_PROBES=if($DashboardProbes){'1'}else{'0'}
 # Never tee the output of prepare-session.py: it contains the ephemeral login/token.
 $privateConfig | ConvertTo-Json | docker compose exec -T backend python manage.py shell -c "exec(open('/tmp/prepare-session.py').read())" | node scripts/perf/benchmark.cjs
 if($LASTEXITCODE){throw "Browser/API smoke benchmark failed; inspect the redacted results file"}
 node scripts/perf/collect-traces.cjs "$Output/$Mode/results.json"
 if($LASTEXITCODE){throw "Trace correlation failed"}
}finally{$env:PERF_NEXT_MODE=$previousMode;$env:PERF_SECTION_MATRIX=$previousMatrix;$env:PERF_DASHBOARD_PROBES=$previousDashboard}
