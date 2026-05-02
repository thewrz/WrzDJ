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
    $script:calls = 0
    Mock -CommandName Invoke-WebRequest -MockWith {
      $script:calls++
      if ($script:calls -lt 3) { throw [System.Net.WebException]::new('404 Not Found') }
      return @{ StatusCode = 200 }
    }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 5 -BackoffSeconds 0 } |
      Should -Not -Throw
    $script:calls | Should -Be 3
  }

  It 'throws after MaxAttempts exhausted' {
    Mock -CommandName Invoke-WebRequest -MockWith { throw '404' }
    Mock -CommandName Start-Sleep -MockWith {}
    { & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 2 -BackoffSeconds 0 } |
      Should -Throw -ExpectedMessage "*not reachable after 2 attempts*"
  }

  It 'uses exponential backoff between attempts' {
    Mock -CommandName Invoke-WebRequest -MockWith { throw '404' }
    $script:sleeps = @()
    Mock -CommandName Start-Sleep -MockWith {
      param($Seconds)
      $script:sleeps += $Seconds
    }
    try {
      & $script:Script -Url 'http://example.com/x.exe' -MaxAttempts 4 -BackoffSeconds 1
    } catch { }
    # attempts 1,2,3 sleep with bases 1,2,4 (attempt 4 throws before sleeping)
    $script:sleeps | Should -Be @(1, 2, 4)
  }
}
