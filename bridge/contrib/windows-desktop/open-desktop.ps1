# Open bothouse web UI (management panel, optional channel) as desktop windows.
# Windows has no native bothouse desktop app; this uses Edge/Chrome app mode.
#
# Example:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\open-desktop.ps1 `
#     -Config "$env:USERPROFILE\.bothouse\config.toml" -ChannelUrl "<channel-url>"
param(
    [string]$Config = (Join-Path $env:USERPROFILE ".bothouse\config.toml"),
    [string]$AdminUrl = "",
    [string]$ChannelUrl = "",
    [ValidateSet("auto", "edge", "chrome")]
    [string]$Browser = "auto",
    [switch]$NoChannel,
    [switch]$ShowToken,
    [switch]$CreateShortcuts,
    [string]$ShortcutDir = "",
    [string]$IconPath = ""
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) { Write-Host "[bothouse-desktop] $Message" }

function Find-Browser {
    param([string]$Preference)
    $edgePaths = @(
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
    )
    $chromePaths = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    )
    $edge = $edgePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    $chrome = $chromePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    switch ($Preference) {
        "edge" { if ($edge) { return $edge } }
        "chrome" { if ($chrome) { return $chrome } }
        default {
            if ($edge) { return $edge }
            if ($chrome) { return $chrome }
        }
    }
    return $null
}

function Read-ManagementUrl {
    param([string]$Path)
    if (-not (Test-Path $Path)) { throw "config.toml not found: $Path" }
    $lines = Get-Content $Path -Encoding UTF8
    $inSection = $false
    $hostName = "localhost"
    $port = 9820
    $token = ""
    foreach ($line in $lines) {
        $trim = $line.Trim()
        if ($trim -match '^\[management\]') { $inSection = $true; continue }
        if ($trim -match '^\[') { $inSection = $false; continue }
        if (-not $inSection) { continue }
        if ($trim -match '^host\s*=\s*"([^"]*)"') { $hostName = $Matches[1] }
        elseif ($trim -match '^port\s*=\s*(\d+)') { $port = [int]$Matches[1] }
        elseif ($trim -match '^token\s*=\s*"([^"]*)"') { $token = $Matches[1] }
    }
    return @{ Url = "http://$hostName`:$port/"; Token = $token }
}

function Open-AppWindow {
    param([string]$BrowserPath, [string]$Url)
    if (-not $BrowserPath) {
        Write-Info "no Edge/Chrome found; opening with the default browser: $Url"
        Start-Process $Url
        return
    }
    Write-Info "opening app window: $Url"
    Start-Process -FilePath $BrowserPath -ArgumentList "--app=$Url"
    Start-Sleep -Milliseconds 800
}

function New-DesktopShortcut {
    param([string]$ScriptPath, [string]$Name)
    $targetDir = if ($ShortcutDir) { $ShortcutDir } else { [Environment]::GetFolderPath("Desktop") }
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    $linkPath = Join-Path $targetDir "$Name.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = "powershell.exe"
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Config `"$Config`""
    if (-not $NoChannel -and $ChannelUrl) { $arguments += " -ChannelUrl `"$ChannelUrl`"" }
    $link.Arguments = $arguments
    $link.WorkingDirectory = Split-Path -Parent $ScriptPath
    if ($IconPath -and (Test-Path $IconPath)) { $link.IconLocation = (Resolve-Path -LiteralPath $IconPath).Path }
    $link.Save()
    Write-Info "created shortcut: $linkPath"
}

# 1) management URL
$management = Read-ManagementUrl -Path $Config
if (-not $AdminUrl) { $AdminUrl = $management.Url }
Write-Info "management url: $AdminUrl"
if ($ShowToken) { Write-Info "management token: $($management.Token)" }

# 2) channel URL (optional)
if (-not $NoChannel -and -not $ChannelUrl) {
    Write-Info "no -ChannelUrl given; opening the management panel only (use -ChannelUrl for a channel page, or -NoChannel to silence this)."
}

# 3) browser
$browserPath = Find-Browser -Preference $Browser
if (-not $browserPath) { Write-Info "Edge/Chrome not found; will fall back to the default browser." }

# 4) open windows
Open-AppWindow -BrowserPath $browserPath -Url $AdminUrl
if (-not $NoChannel -and $ChannelUrl) { Open-AppWindow -BrowserPath $browserPath -Url $ChannelUrl }

# 5) optional shortcuts
if ($CreateShortcuts) {
    if (-not $IconPath) {
        $defaultIcon = Join-Path $PSScriptRoot "bothouse.ico"
        if (Test-Path $defaultIcon) { $IconPath = $defaultIcon }
    }
    $scriptPath = $MyInvocation.MyCommand.Path
    New-DesktopShortcut -ScriptPath $scriptPath -Name "bothouse 管理面板"
    if (-not $NoChannel -and $ChannelUrl) {
        New-DesktopShortcut -ScriptPath $scriptPath -Name "bothouse 频道"
    }
}

Write-Info "done."
