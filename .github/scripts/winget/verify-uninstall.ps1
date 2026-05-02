#requires -Version 5.1
<#
.SYNOPSIS
  Run silent uninstall via Squirrel Update.exe and assert success.
.DESCRIPTION
  Winget validation requires that silent uninstall exits with code 0.
  Optionally asserts the install directory was removed (StrictCleanup).
#>
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\wrzdj-bridge",
  [switch]$StrictCleanup
)

$ErrorActionPreference = 'Stop'

$update = Join-Path $InstallDir 'Update.exe'
if (-not (Test-Path $update)) {
  throw "Update.exe not found at $update — was the app installed?"
}

$proc = Start-Process -FilePath $update -ArgumentList '--uninstall' -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
  throw "Uninstall failed with exit code $($proc.ExitCode)"
}

Start-Sleep -Seconds 2

if ($StrictCleanup -and (Test-Path $InstallDir)) {
  $remaining = Get-ChildItem $InstallDir -ErrorAction SilentlyContinue
  if ($remaining) {
    throw "Uninstall reported success but install dir still present at $InstallDir"
  }
}

Write-Host "Silent uninstall completed (exit code 0)"
