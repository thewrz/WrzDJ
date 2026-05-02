#requires -Module @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
  $script:Script = Join-Path $PSScriptRoot '..' 'verify-arp-version.ps1'
}

Describe 'verify-arp-version.ps1' {
  It 'passes when ARP DisplayVersion matches expected' {
    Mock -CommandName Get-ItemProperty -MockWith { @{ DisplayVersion = '2026.408.0' } }
    { & $script:Script -Expected '2026.408.0' } | Should -Not -Throw
  }

  It 'throws when ARP DisplayVersion differs' {
    Mock -CommandName Get-ItemProperty -MockWith { @{ DisplayVersion = '0.1.0' } }
    { & $script:Script -Expected '2026.408.0' } |
      Should -Throw -ExpectedMessage "*0.1.0*2026.408.0*"
  }

  It 'throws when no ARP entry found in any hive' {
    Mock -CommandName Get-ItemProperty -MockWith { $null }
    { & $script:Script -Expected '2026.408.0' } |
      Should -Throw -ExpectedMessage "*not found*"
  }

  It 'reads from HKCU first, falls through to HKLM' {
    $script:hits = @()
    Mock -CommandName Get-ItemProperty -MockWith {
      param($Path)
      $script:hits += $Path
      if ($Path -like 'HKLM:*') { return @{ DisplayVersion = '2026.408.0' } }
      return $null
    }
    & $script:Script -Expected '2026.408.0'
    $script:hits[0] | Should -BeLike 'HKCU:*'
  }
}
