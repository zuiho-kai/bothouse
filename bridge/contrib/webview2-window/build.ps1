# Build the bothouse Windows window shell (WinForms + WebView2).
#
# Requires only what ships with Windows 10/11:
#   - .NET Framework 4.8 (csc.exe)
#   - Windows PowerShell 5.1 (Expand-Archive)
# The WebView2 SDK NuGet package is downloaded automatically on first build and
# cached per version, so switching versions or deleting a file triggers a refetch.
#
# Examples:
#   .\build.ps1                       # dev build: bin\BothouseWindow.exe + 3 WebView2 DLLs
#   .\build.ps1 -SingleFile           # one exe with the 3 DLLs embedded as resources
#   .\build.ps1 -SingleFile -Icon ..\..\artifacts\bothouse-desktop\assets\bothouse.ico
#   .\build.ps1 -NuGetVersion ""      # use the latest WebView2 SDK (not reproducible)

param(
    [string]$OutDir = "$PSScriptRoot\bin",
    [switch]$SingleFile,
    [string]$Icon,
    [string]$SdkRoot = "$PSScriptRoot\.webview2-sdk",
    # Pinned so a rebuild uses the SDK that was tested. Pass "" for latest.
    [string]$NuGetVersion = "1.0.4314.35",
    [string]$Csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Csc)) {
    $Csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $Csc)) {
    throw "csc.exe not found. Install .NET Framework 4.8 (it ships with Windows 10/11)."
}

# ---- WebView2 SDK (cached per version) --------------------------------------
function Get-NuspecVersion([string]$dir) {
    $nuspec = Join-Path $dir "Microsoft.Web.WebView2.nuspec"
    if (-not (Test-Path $nuspec)) {
        $candidate = Get-ChildItem $dir -Filter *.nuspec -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($candidate) { $nuspec = $candidate.FullName }
    }
    if (-not (Test-Path $nuspec)) { return $null }
    $text = Get-Content $nuspec -Raw
    $match = [regex]::Match($text, '<version>\s*([^<\s]+)\s*</version>')
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}

function Test-Sdk([string]$dir, [string]$expectedVersion) {
    $core = Join-Path $dir "lib\net462\Microsoft.Web.WebView2.Core.dll"
    $winForms = Join-Path $dir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
    $loader = Join-Path $dir "build\native\x64\WebView2Loader.dll"
    if (-not (Test-Path $core) -or -not (Test-Path $winForms) -or -not (Test-Path $loader)) { return $false }
    $actual = Get-NuspecVersion $dir
    if ($null -eq $actual) { return $false }
    if (-not [string]::IsNullOrEmpty($expectedVersion) -and $actual -ne $expectedVersion) { return $false }
    return $true
}

function Save-Download([string]$url, [string]$out) {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 180
}

function Download-Sdk([string]$version) {
    $packageUrl = if ([string]::IsNullOrEmpty($version)) {
        "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2"
    } else {
        "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$version"
    }

    New-Item -ItemType Directory -Path $SdkRoot -Force | Out-Null
    $tempRoot = Join-Path $env:TEMP ("bothouse-webview2-" + [guid]::NewGuid().ToString("N"))
    $zip = Join-Path $tempRoot "package.zip"
    $extract = Join-Path $tempRoot "sdk"
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    # Prefer a direct connection; a dead/blocked HTTP(S)_PROXY otherwise hangs
    # Invoke-WebRequest until its timeout. Retry through the proxy on failure.
    $proxyVars = @('HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy')
    $savedProxy = @{}
    foreach ($name in $proxyVars) { $savedProxy[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

    try {
        foreach ($name in $proxyVars) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        try {
            Save-Download $packageUrl $zip
        } catch {
            Write-Host "[build] direct download failed, retrying through configured proxy..."
            foreach ($name in $proxyVars) {
                [Environment]::SetEnvironmentVariable($name, $savedProxy[$name], 'Process')
            }
            Save-Download $packageUrl $zip
        }
        Expand-Archive -Path $zip -DestinationPath $extract -Force
    } finally {
        foreach ($name in $proxyVars) {
            [Environment]::SetEnvironmentVariable($name, $savedProxy[$name], 'Process')
        }
    }

    $actual = Get-NuspecVersion $extract
    if ($null -eq $actual) { throw "Downloaded WebView2 package has no readable .nuspec version." }
    if (-not [string]::IsNullOrEmpty($version) -and $actual -ne $version) {
        throw "Requested WebView2 $version but the package contains $actual."
    }

    $target = Join-Path $SdkRoot $actual
    if (-not (Test-Sdk $target $actual)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Get-ChildItem $extract -Force | ForEach-Object { Copy-Item $_.FullName $target -Recurse -Force }
    }
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    return $target
}

$requestedVersion = $NuGetVersion
$versionKey = if ([string]::IsNullOrEmpty($requestedVersion)) { "latest" } else { $requestedVersion }
$sdkDir = Join-Path $SdkRoot $versionKey
if (-not (Test-Sdk $sdkDir $requestedVersion)) {
    Write-Host "[build] WebView2 SDK $versionKey not cached; downloading..."
    $sdkDir = Download-Sdk $requestedVersion
}
$actualVersion = Get-NuspecVersion $sdkDir
Write-Host "[build] WebView2 SDK: $actualVersion ($sdkDir)"

$coreDll = Join-Path $sdkDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
$winFormsDll = Join-Path $sdkDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $sdkDir "build\native\x64\WebView2Loader.dll"
foreach ($path in @($coreDll, $winFormsDll, $loaderDll)) {
    if (-not (Test-Path $path)) { throw "WebView2 SDK file missing: $path" }
}

# ---- compile ----------------------------------------------------------------
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$out = Join-Path $OutDir "BothouseWindow.exe"
$source = Join-Path $PSScriptRoot "ShellForm.cs"
$manifest = Join-Path $PSScriptRoot "app.manifest"
if (-not (Test-Path $manifest)) { throw "app.manifest not found: $manifest" }

$common = @(
    "/target:winexe",
    "/langversion:5",
    "/optimize+",
    "/platform:x64",
    "/win32manifest:$manifest",
    "/reference:$coreDll",
    "/reference:$winFormsDll",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Security.dll",
    $source
)

$args = @("/out:$out") + $common
if ($SingleFile) {
    $args += @("/resource:$coreDll", "/resource:$winFormsDll", "/resource:$loaderDll")
}
if ($Icon) {
    if (-not (Test-Path $Icon)) { throw "Icon not found: $Icon" }
    $args = @("/win32icon:$Icon") + $args
}

& $Csc @args
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE" }

if (-not $SingleFile) {
    Copy-Item $coreDll, $winFormsDll, $loaderDll $OutDir -Force
}
Write-Host ("[build] OK: {0} ({1:N0} bytes)" -f $out, (Get-Item $out).Length)
if (-not $SingleFile) {
    Write-Host "[build] runtime DLLs copied to $OutDir"
}