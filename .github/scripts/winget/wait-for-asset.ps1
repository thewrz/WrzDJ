#requires -Version 5.1
<#
.SYNOPSIS
  HEAD-poll a release asset URL with exponential backoff.
.DESCRIPTION
  GitHub Releases CDN replication can lag a few seconds after a release is
  published. wingetcreate downloads the asset to compute its SHA256; a 404
  during that window aborts the manifest update. This script HEAD-polls the
  URL until 200 (or the attempt cap is reached).
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [int]$MaxAttempts = 6,
  [int]$BackoffSeconds = 5
)

$ErrorActionPreference = 'Stop'

for ($i = 1; $i -le $MaxAttempts; $i++) {
  try {
    $resp = Invoke-WebRequest -Method Head -Uri $Url -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
      Write-Host "Asset reachable at attempt ${i}: $Url"
      return
    }
    Write-Host "Attempt ${i}: status $($resp.StatusCode), retrying"
  } catch {
    Write-Host "Attempt ${i} failed: $($_.Exception.Message)"
    if ($i -eq $MaxAttempts) {
      throw "Asset $Url not reachable after $MaxAttempts attempts"
    }
  }
  $sleep = [math]::Pow(2, $i - 1) * $BackoffSeconds
  Start-Sleep -Seconds $sleep
}
