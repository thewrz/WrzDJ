#requires -Version 5.1
<#
.SYNOPSIS
  Verify Squirrel-installed app's ARP DisplayVersion matches expected semver.
.DESCRIPTION
  Squirrel writes Add/Remove Programs entries to HKCU\...\Uninstall\<AppId>.
  Winget post-install validation rejects packages whose installed ARP version
  differs from the manifest version. This script catches version-injection
  regressions (e.g. silent npm-version failure leaving DisplayVersion=0.1.0).
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Expected,

  [string]$AppId = 'wrzdj-bridge'
)

$ErrorActionPreference = 'Stop'

$keys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
)

$arp = $null
foreach ($k in $keys) {
  $entry = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
  if ($entry) { $arp = $entry; break }
}

if (-not $arp) {
  throw "ARP entry not found for AppId '$AppId' (searched HKCU + HKLM Uninstall keys)"
}

if ($arp.DisplayVersion -ne $Expected) {
  throw "ARP DisplayVersion '$($arp.DisplayVersion)' does not match expected '$Expected'"
}

Write-Host "ARP DisplayVersion match: $Expected"
