# Verify the documented install paths by downloading through the SYSTEM PROXY, then checking locally.
#   & .\evidence\verify-install-path.ps1
# Why not node fetch: Node's native fetch ignores the system proxy and direct connections are blocked on this host.
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as the ANSI codepage and mangles non-ASCII text.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$ver = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$local = Join-Path $repo ("dsh-external-dsh-prompt-optimizer-{0}.tgz" -f $ver)
if (-not (Test-Path $local)) { Write-Host "local tgz missing: $local (run npm pack first)"; exit 1 }
$bad = $false
$tmp = Join-Path $env:TEMP ('dsh-install-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$base = 'https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases'
$targets = @(
  @{ name = 'README recommended (releases/latest alias)'; url = ($base + '/latest/download/dsh-external-dsh-prompt-optimizer.tgz'); file = 'alias.tgz' },
  @{ name = ('versioned link (v' + $ver + ')');           url = ($base + '/download/v' + $ver + '/dsh-external-dsh-prompt-optimizer-' + $ver + '.tgz'); file = 'versioned.tgz' }
)
Write-Host ("local tgz = dsh-external-dsh-prompt-optimizer-$ver.tgz  " + (Get-Item $local).Length + " bytes")
Write-Host ''
$files = @()
foreach ($t in $targets) {
  try {
    $out = Join-Path $tmp $t.file
    Invoke-WebRequest -Uri $t.url -OutFile $out -TimeoutSec 120 -UseBasicParsing
    $files += $out
    Write-Host ('OK  ' + $t.name)
  } catch { Write-Host ('FAIL ' + $t.name + ' : ' + $_.Exception.Message); $bad = $true }
}
# The download page itself: follow the redirect and confirm it lands on this version
try {
  $r = Invoke-WebRequest -Uri ($base + '/latest') -TimeoutSec 120 -UseBasicParsing
  $final = ''
  try { $final = $r.BaseResponse.ResponseUri.AbsoluteUri } catch { $final = '' }
  if (-not $final) { try { $final = $r.BaseResponse.RequestMessage.RequestUri.AbsoluteUri } catch { $final = '' } }
  Write-Host ('OK  download page redirects to: ' + $final)
  if ($final -notmatch [regex]::Escape('/v' + $ver)) { Write-Host ('FAIL redirect target is not v' + $ver); $bad = $true }
} catch { Write-Host ('FAIL download page : ' + $_.Exception.Message); $bad = $true }
Write-Host ''
if ($files.Count -gt 0) { node (Join-Path $PSScriptRoot 'inspect-tgz.cjs') @files --vs $local }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($bad) { Write-Host ''; Write-Host 'VERDICT: FAIL'; exit 2 }
Write-Host ''
Write-Host ("VERDICT: installing by the docs gets $ver  [OK]")
