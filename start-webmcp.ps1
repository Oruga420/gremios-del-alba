param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$chromeCandidates = @(
    if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe' }
    if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }
    if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
)
$chromePath = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $chromePath) {
    $chromeCommand = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($chromeCommand) { $chromePath = $chromeCommand.Source }
}
if (-not $chromePath) { throw 'Google Chrome was not found. Install Chrome to use the native WebMCP launcher, or use PLAY.cmd with your default browser.' }
$chromeVersion = (Get-Item -LiteralPath $chromePath).VersionInfo.ProductVersion
$profilePath = [IO.Path]::GetFullPath((Join-Path $projectRoot '.local\browser\webmcp'))
if (-not $profilePath.StartsWith(($projectRoot.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'The WebMCP browser profile must remain within this project.' }
$arguments = @('--enable-features=WebMCP', '--force-high-performance-gpu', ('--user-data-dir="' + $profilePath + '"'), '--no-first-run', '--no-default-browser-check', 'http://127.0.0.1:4173')
if ($VerifyOnly) { [pscustomobject]@{ Chrome=$chromePath; Version=$chromeVersion; Profile=$profilePath; Arguments=$arguments; GlobalPreferencesChanged=$false; FeatureFlagSource='https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/about_flags.cc' } | ConvertTo-Json -Depth 4; exit 0 }
& (Join-Path $projectRoot 'start-game.ps1') -NoBrowser
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
# This is the explicitly requested interactive game window, using only a project profile.
Start-Process -FilePath $chromePath -ArgumentList $arguments
Write-Host "Gremios del Alba with native WebMCP in Chrome $chromeVersion"
Write-Host 'High-performance GPU requested for this game profile. Save and close existing game windows before reopening to apply new launch options.'
Write-Host 'http://127.0.0.1:4173'
