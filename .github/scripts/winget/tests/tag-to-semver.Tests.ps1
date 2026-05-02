#requires -Module @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
  $script:Script = Join-Path $PSScriptRoot '..' 'tag-to-semver.ps1'
}

Describe 'tag-to-semver.ps1' {
  It 'v2026.04.08 -> 2026.408.0' {
    & $script:Script 'v2026.04.08' | Should -Be '2026.408.0'
  }

  It 'v2026.04.08.12 -> 2026.408.12' {
    & $script:Script 'v2026.04.08.12' | Should -Be '2026.408.12'
  }

  It 'v2026.12.31 -> 2026.1231.0' {
    & $script:Script 'v2026.12.31' | Should -Be '2026.1231.0'
  }

  It 'v2026.01.01 -> 2026.101.0' {
    & $script:Script 'v2026.01.01' | Should -Be '2026.101.0'
  }

  It 'v2026.02.08.13 -> 2026.208.13' {
    & $script:Script 'v2026.02.08.13' | Should -Be '2026.208.13'
  }

  It 'accepts tag without v prefix' {
    & $script:Script '2026.04.08' | Should -Be '2026.408.0'
  }

  It 'fails on malformed input' {
    { & $script:Script 'garbage' 2>$null } | Should -Throw
  }
}
