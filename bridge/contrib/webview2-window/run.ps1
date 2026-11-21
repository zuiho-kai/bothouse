# Launch the bothouse Windows window shell.
#
# Examples:
#   .\run.ps1
#   .\run.ps1 -ChannelUrl "http://127.0.0.1:8790/#token=..."
#   .\run.ps1 -ManagementUrl "http://127.0.0.1:9820/"
#   .\run.ps1 -StartService        # start "bothouse" in the background first

param(
    [string]$ChannelUrl,
    [string]$ManagementUrl,
    [string]$Exe = "$PSScriptRoot\bin\BothouseWindow.exe",
    [switch]$StartService,
    [string]$BothouseExe = "bothouse"
)

$ErrorActionPreference = "Stop"

function Test-Port([int]$port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Path $Exe)) {
    throw "找不到 $Exe，请先运行 .\build.ps1（或 build.ps1 -SingleFile）"
}

$checkChannelPort = [string]::IsNullOrEmpty($ChannelUrl)
$checkManagementPort = [string]::IsNullOrEmpty($ManagementUrl)

if ($StartService) {
    if (-not (Get-Command $BothouseExe -ErrorAction SilentlyContinue)) {
        Write-Warning "[run] 未找到 bothouse 命令，跳过 -StartService"
    } elseif (Test-Port 8790) {
        Write-Host "[run] 8790 已在监听，跳过 -StartService（避免重复启动）"
    } else {
        Write-Host "[run] 后台启动 bothouse（日志见 ~/.bothouse/run.log）"
        $log = Join-Path $env:USERPROFILE ".bothouse\run.log"
        New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
        $previousLog = $env:CC_LOG_FILE
        try {
            $env:CC_LOG_FILE = $log
            Start-Process -FilePath $BothouseExe -WindowStyle Hidden
        } finally {
            if ($null -eq $previousLog) { Remove-Item Env:CC_LOG_FILE -ErrorAction SilentlyContinue }
            else { $env:CC_LOG_FILE = $previousLog }
        }
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 1
            if ((Test-Port 8790) -and (Test-Port 9820)) { break }
        }
    }
}

# Port prechecks only apply to the default local URLs; explicit URLs may target
# another host or port and must not be treated as failures.
if ($checkChannelPort -and -not (Test-Port 8790)) {
    Write-Warning "[run] 8790 没在监听，频道页可能加载失败"
}
if ($checkManagementPort -and -not (Test-Port 9820)) {
    Write-Warning "[run] 9820 没在监听，管理面板可能加载失败"
}

$arguments = @()
if ($ChannelUrl) { $arguments += @("--channel-url", $ChannelUrl) }
if ($ManagementUrl) { $arguments += @("--management-url", $ManagementUrl) }

# Win32_Process.Create starts the GUI outside the current PowerShell job and
# returns a real result, so a failure cannot be reported as a success. It also
# avoids Start-Process problems when both NO_PROXY and no_proxy are present.
$commandLine = '"' + $Exe + '"'
if ($arguments.Count -gt 0) {
    $quoted = ($arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $commandLine += ' ' + $quoted
}
try {
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $commandLine
        CurrentDirectory = (Split-Path $Exe)
    }
} catch {
    throw "启动失败（WMI Win32_Process.Create）：$($_.Exception.Message)"
}
if ($null -eq $created -or $created.ReturnValue -ne 0) {
    throw "启动失败：Win32_Process.Create ReturnValue=$($created.ReturnValue)"
}

$processId = [int]$created.ProcessId
Start-Sleep -Milliseconds 800
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($null -eq $process) {
    throw "进程启动后立即退出（pid $processId）。请检查 bothouse-window.log / fatal.log。"
}
Write-Host "[run] 已启动 $Exe (pid $processId)"