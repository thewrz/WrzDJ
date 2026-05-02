#requires -Version 5.1
<#
.SYNOPSIS
  Convert WrzDJ date tag (v2026.04.08[.R]) to NuGet/Squirrel-compatible 3-part semver.
.DESCRIPTION
  Output: <YYYY>.<MM*100+DD>.<R|0>
  Mirror of tag-to-semver.sh — kept in sync via paired tests.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Tag
)

$clean = $Tag.TrimStart('v')

if ($clean -notmatch '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$') {
  Write-Error "Cannot convert '$Tag' — expected v<YYYY>.<MM>.<DD>[.<R>]"
  exit 1
}

$parts = $clean.Split('.')
$y = [int]$parts[0]
$m = [int]$parts[1]
$d = [int]$parts[2]
$r = if ($parts.Length -gt 3) { [int]$parts[3] } else { 0 }

$semver = "$y.$($m * 100 + $d).$r"
Write-Output $semver
