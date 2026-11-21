param([Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$qaConfig=@{}
Get-Content .env | ForEach-Object {
 if($_ -match '^([^#=]+)=(.*)$'){$qaConfig[$matches[1]]=$matches[2].Trim('"')}
}
$previousOutput=$env:UOG_QA_OUTPUT
try {
 $env:UOG_QA_OUTPUT=$OutputDirectory
 foreach($stage in @('media','menus','article','page','homepage','negative','public')) {
  # Private credentials stay on the pipe; never tee this stream to an evidence log.
  $qaConfig|ConvertTo-Json|docker compose exec -T backend python manage.py shell -c "exec(open('/tmp/qa-college-workflow-session.py',encoding='utf-8-sig').read())"|node scripts/qa-main-workflow-browser.cjs $stage
  if($LASTEXITCODE -ne 0){throw "College UI stage failed: $stage. Retain the private journal and inspect sanitized evidence."}
 }
} finally {$env:UOG_QA_OUTPUT=$previousOutput;Remove-Variable qaConfig}
