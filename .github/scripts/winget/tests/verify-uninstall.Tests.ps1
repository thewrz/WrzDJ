#requires -Module @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
  $script:Script = Join-Path $PSScriptRoot '..' 'verify-uninstall.ps1'
}

Describe 'verify-uninstall.ps1' {
  It 'passes when Update.exe exits 0' {
    Mock -CommandName Test-Path -MockWith { $true }
    Mock -CommandName Start-Process -MockWith { [pscustomobject]@{ ExitCode = 0 } }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -InstallDir 'TestDrive:\fake' } | Should -Not -Throw
  }

  It 'throws when Update.exe exits nonzero' {
    Mock -CommandName Test-Path -MockWith { $true }
    Mock -CommandName Start-Process -MockWith { [pscustomobject]@{ ExitCode = 1 } }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -InstallDir 'TestDrive:\fake' } |
      Should -Throw -ExpectedMessage "*exit code 1*"
  }

  It 'throws when Update.exe missing' {
    Mock -CommandName Test-Path -MockWith { $false }
    { & $script:Script -InstallDir 'TestDrive:\nope' } |
      Should -Throw -ExpectedMessage "*not found*"
  }

  It 'StrictCleanup throws if install dir still has children' {
    Mock -CommandName Test-Path -MockWith { $true }
    Mock -CommandName Start-Process -MockWith { [pscustomobject]@{ ExitCode = 0 } }
    Mock -CommandName Start-Sleep -MockWith {}
    Mock -CommandName Get-ChildItem -MockWith { ,@([pscustomobject]@{ Name = 'leftover.dat' }) }
    { & $script:Script -InstallDir 'TestDrive:\fake' -StrictCleanup } |
      Should -Throw -ExpectedMessage "*still present*"
  }
}
