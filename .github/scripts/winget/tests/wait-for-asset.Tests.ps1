#requires -Module @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
  $script:Script = Join-Path $PSScriptRoot '..' 'wait-for-asset.ps1'
}

Describe 'wait-for-asset.ps1' {
  It 'returns immediately on first 200' {
    Mock -CommandName Invoke-WebRequest -MockWith { @{ StatusCode = 200 } }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 3 -BackoffSeconds 0 } |
      Should -Not -Throw
    Should -Invoke -CommandName Invoke-WebRequest -Times 1 -Exactly
  }

  It 'retries on failure then succeeds' {
    $callRef = [ref]0
    Mock -CommandName Invoke-WebRequest -MockWith {
      $callRef.Value++
      if ($callRef.Value -lt 3) { throw [System.Net.WebException]::new('404 Not Found') }
      return @{ StatusCode = 200 }
    }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 5 -BackoffSeconds 0 } |
      Should -Not -Throw
    Should -Invoke -CommandName Invoke-WebRequest -Times 3 -Exactly
  }

  It 'throws after MaxAttempts exhausted' {
    Mock -CommandName Invoke-WebRequest -MockWith { throw '404' }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 2 -BackoffSeconds 0 } |
      Should -Throw -ExpectedMessage "*not reachable after 2 attempts*"
  }

  It 'uses exponential backoff between attempts' {
    Mock -CommandName Invoke-WebRequest -MockWith { throw '404' }
    Mock -CommandName Start-Sleep -MockWith {}
    try {
      & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 4 -BackoffSeconds 1
    } catch { }
    # attempts 1,2,3 sleep with bases 1,2,4 (attempt 4 throws before sleeping)
    Should -Invoke -CommandName Start-Sleep -Times 1 -Exactly -ParameterFilter { $Seconds -eq 1 }
    Should -Invoke -CommandName Start-Sleep -Times 1 -Exactly -ParameterFilter { $Seconds -eq 2 }
    Should -Invoke -CommandName Start-Sleep -Times 1 -Exactly -ParameterFilter { $Seconds -eq 4 }
    Should -Invoke -CommandName Start-Sleep -Times 3 -Exactly
  }
}
