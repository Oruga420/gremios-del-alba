param([switch]$NoBrowser, [switch]$SkipAwakening)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$runtimeDirectory = Join-Path $projectRoot '.local\server'
$gameUrl = 'http://127.0.0.1:4173'
$healthUrl = "$gameUrl/health"
$serverPath = Join-Path $projectRoot 'server.mjs'
$projectName = 'gremios-del-alba'
$startedProcess = $null
$serverVerified = $false

function Read-ProjectHealth {
    try { return Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 -ErrorAction Stop }
    catch { return $null }
}

function Confirm-ProjectHealth($health) {
    if ($null -eq $health -or $health.ok -ne $true -or $health.project -ne $projectName) { return $false }
    if ([string]::IsNullOrWhiteSpace([string]$health.root)) { return $false }
    $reportedRoot = [System.IO.Path]::GetFullPath([string]$health.root).TrimEnd('\')
    if (-not [string]::Equals($projectRoot, $reportedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ($health.serverSha256 -ne (Get-FileHash -LiteralPath $serverPath -Algorithm SHA256).Hash.ToLowerInvariant()) { return $false }
    $runtimePid = 0
    if (-not [int]::TryParse([string]$health.pid, [ref]$runtimePid) -or $runtimePid -le 0) { return $false }
    $listeners = @(Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue)
    if (-not ($listeners | Where-Object { $_.OwningProcess -eq $runtimePid -and $_.LocalAddress -eq '127.0.0.1' })) { return $false }
    $runtimeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$runtimePid" -ErrorAction SilentlyContinue
    if ($null -eq $runtimeProcess -or [System.IO.Path]::GetFileName([string]$runtimeProcess.ExecutablePath) -ne 'node.exe') { return $false }
    if ($runtimeProcess.CommandLine -notmatch 'server\.mjs') { return $false }
    return $true
}

try {
    if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) { throw 'No existe server.mjs en esta carpeta del proyecto.' }
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $health = Read-ProjectHealth
    if (-not (Confirm-ProjectHealth $health)) {
        $listeners = @(Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) { throw 'El puerto 4173 ya tiene un proceso cuya identidad o version no coincide. Cierra esa instancia manualmente y vuelve a abrir PLAY.cmd. No se ha detenido ningun proceso.' }
        $launchId = [guid]::NewGuid().ToString('N')
        $stdoutPath = Join-Path $runtimeDirectory "$launchId.stdout.log"
        $stderrPath = Join-Path $runtimeDirectory "$launchId.stderr.log"
        $priorGuildPort = $env:GUILD_PORT
        try {
            $env:GUILD_PORT = '4173'
            $startedProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--env-file-if-exists=.env', ('"' + $serverPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        } finally { $env:GUILD_PORT = $priorGuildPort }
        $deadline = [datetime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            $startedProcess.Refresh()
            if ($startedProcess.HasExited) { throw "El servidor no pudo arrancar. Revisa $stderrPath" }
            $health = Read-ProjectHealth
        } while (-not (Confirm-ProjectHealth $health) -and [datetime]::UtcNow -lt $deadline)
        if (-not (Confirm-ProjectHealth $health)) { throw "El servidor no confirmo su identidad. Revisa $stderrPath" }
        $identity = [ordered]@{ project = $projectName; pid = [int]$health.pid; root = $projectRoot; serverSha256 = $health.serverSha256; startedAt = $startedProcess.StartTime.ToUniversalTime().ToString('o'); executable = $nodeExecutable; url = $gameUrl; launchId = $launchId; stdout = $stdoutPath; stderr = $stderrPath; startupOwned = $true }
    } else {
        $identity = [ordered]@{ project = $projectName; pid = [int]$health.pid; root = $projectRoot; serverSha256 = $health.serverSha256; observedAt = [datetime]::UtcNow.ToString('o'); executable = $nodeExecutable; url = $gameUrl; startupOwned = $false }
    }
    $identityPath = Join-Path $runtimeDirectory 'identity.json'
    $temporaryPath = Join-Path $runtimeDirectory ([guid]::NewGuid().ToString('N') + '.tmp')
    $identity | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $identityPath -Force
    $serverVerified = $true
    if (-not $NoBrowser) {
        try { Start-Process -FilePath $gameUrl }
        catch { Write-Warning "El servidor esta listo. Abre $gameUrl en tu navegador." }
    }
    Write-Output "GAME_READY $gameUrl PID=$($health.pid) ROOT=$projectRoot"
} catch {
    if ($null -ne $startedProcess -and -not $serverVerified) {
        $startedProcess.Refresh()
        if (-not $startedProcess.HasExited) { Stop-Process -InputObject $startedProcess -ErrorAction SilentlyContinue }
    }
    Write-Error $_.Exception.Message
    exit 1
}
