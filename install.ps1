# CoNest cc-connect installer for Windows: downloads the prebuilt binary (with the setup wizard)
# from the GitHub Release, puts it in %USERPROFILE%\.local\bin and adds that to your user PATH.
# No Go or Node needed. Windows PowerShell 5.1 or PowerShell 7, x64 or arm64.
#
#   irm https://raw.githubusercontent.com/Zssan12/conest/main/install.ps1 | iex      # public repo
#   gh api repos/Zssan12/conest/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Out-String | iex   # private repo, gh logged in
#
# Environment:
#   CONEST_VERSION   tag to install (default: the newest release, pre-releases included)
#   INSTALL_DIR      where to put cc-connect.exe (default: %USERPROFILE%\.local\bin)
#   CONEST_REPO      owner/name to install from (default: Zssan12/conest; CI uses it for a test copy)
# Same steps as install.sh (macOS / Linux).

# Everything runs from Install-CcConnect, called on the last line: if an `irm | iex` download is
# cut short, the function is never called and nothing runs. Errors throw instead of `exit`, so the
# window you pasted into stays open.
function Install-CcConnect {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # Windows PowerShell 5.1 downloads are very slow with the progress bar
  # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = if ($env:CONEST_REPO) { $env:CONEST_REPO } else { 'Zssan12/conest' }
  if ($repo -notmatch '^[\w.-]+/[\w.-]+$') { throw "install.ps1: CONEST_REPO must look like owner/name, got '$repo'" }
  $installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $HOME '.local\bin' }

  function Fail($msg) { throw "install.ps1: $msg" }
  function Test-Gh {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return $false }
    & gh auth status *> $null
    return ($LASTEXITCODE -eq 0)
  }

  # OS architecture, not this PowerShell's (x64 PowerShell runs emulated on arm64 Windows).
  $archName = $null
  try { $archName = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch { }
  if (-not $archName) {
    $archName = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  }
  switch -Regex ($archName) {
    '^(X64|AMD64)$' { $arch = 'amd64' }
    '^(Arm64|ARM64)$' { $arch = 'arm64' }
    default { Fail "unsupported CPU $($archName): arm64 and amd64 only" }
  }

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cc-connect-install-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    # 1. which release: public API first; a private repo answers 404 there, then the logged-in gh
    $tag = $env:CONEST_VERSION
    $via = 'web'
    if (-not $tag) {
      try {
        $rel = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$repo/releases?per_page=1"
        if ($rel) { $tag = @($rel)[0].tag_name }
      } catch { }
      if (-not $tag -and (Test-Gh)) {
        $tag = (& gh api "repos/$repo/releases?per_page=1" --jq '.[0].tag_name' 2>$null | Out-String).Trim()
        $via = 'gh'
      }
      if (-not $tag) {
        Fail "no release found for $repo. The repo may be private: install the GitHub CLI (winget install GitHub.cli), run 'gh auth login' with an account that can see the repo, and run this again."
      }
    }

    $asset = "cc-connect-$tag-windows-$arch.zip"
    $from = if ($repo -ne 'Zssan12/conest') { " from $repo" } else { '' }
    Write-Host "Installing cc-connect $tag (windows/$arch)$from into $installDir"

    # 2. download
    $zip = Join-Path $tmp $asset
    $sums = Join-Path $tmp 'checksums.txt'
    $fetchWeb = {
      $base = "https://github.com/$repo/releases/download/$tag"
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $zip
        Invoke-WebRequest -UseBasicParsing -Uri "$base/checksums.txt" -OutFile $sums
        return $true
      } catch { return $false }
    }
    $fetchGh = {
      if (-not (Test-Gh)) { return $false }
      & gh release download $tag -R $repo -p $asset -p checksums.txt -D $tmp --clobber
      return ($LASTEXITCODE -eq 0)
    }
    if ($via -eq 'gh') {
      if (-not (& $fetchGh)) { Fail "download failed: gh release download $tag -R $repo -p $asset" }
    } elseif (-not (& $fetchWeb) -and -not (& $fetchGh)) {
      Fail "download failed: $asset of $tag. Private repo? Install gh (winget install GitHub.cli) and run 'gh auth login' first."
    }

    # 3. verify and install
    $expected = $null
    foreach ($line in Get-Content -LiteralPath $sums) {
      $parts = $line -split '\s+', 2
      if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $asset) { $expected = $parts[0].ToLower() }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
    if (-not $expected -or $expected -ne $actual) { Fail "checksum mismatch for $asset" }
    Write-Host "Checksum OK ($asset sha256 $actual)"

    $unpack = Join-Path $tmp 'unpack'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
    $newExe = Join-Path $unpack 'cc-connect.exe'
    if (-not (Test-Path -LiteralPath $newExe)) { Fail "cc-connect.exe not found in $asset" }

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    $target = Join-Path $installDir 'cc-connect.exe'
    # Earlier backups first (best effort: one still running stays), then move the current exe
    # aside under a fresh name. A running cc-connect.exe cannot be overwritten or deleted, but it
    # can be renamed; a fixed backup name would collide with a backup that is still running.
    Get-ChildItem -LiteralPath $installDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ieq 'cc-connect.exe.old' -or $_.Name -like 'cc-connect.exe.old-*' } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $target) {
      Move-Item -LiteralPath $target -Destination ("$target.old-" + [DateTime]::UtcNow.Ticks) -Force
    }
    Move-Item -LiteralPath $newExe -Destination $target -Force
    & $target --version | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "installed, but $target does not run" }
    Write-Host "Installed: $target ($tag)"

    # 4. PATH: add the folder to the user PATH (new windows) and to this window's PATH.
    # Read and write the raw registry value: [Environment]::GetEnvironmentVariable expands
    # %VARS% and would write them back expanded (and as REG_SZ), breaking entries like %USERPROFILE%\bin.
    $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    $userPathRaw = [string]$envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $samePath = { param($a) $a -and ([Environment]::ExpandEnvironmentVariables($a).TrimEnd('\') -ieq $installDir.TrimEnd('\')) }
    if (-not @($userPathRaw -split ';' | Where-Object { & $samePath $_ }).Count) {
      $newPath = if ($userPathRaw) { "$installDir;$userPathRaw" } else { $installDir }
      $envKey.SetValue('Path', $newPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
      # tell Explorer (and so new windows) that the environment changed: setting any user
      # variable through .NET broadcasts WM_SETTINGCHANGE
      [Environment]::SetEnvironmentVariable('CONEST_INSTALL_PING', '1', 'User')
      [Environment]::SetEnvironmentVariable('CONEST_INSTALL_PING', $null, 'User')
      Write-Host "Added $installDir to your user PATH (new terminal windows pick it up)."
    }
    $envKey.Close()
    if (-not @($env:Path -split ';' | Where-Object { & $samePath $_ }).Count) { $env:Path = "$installDir;$env:Path" }

    # What a new window will run for `cc-connect`: the system PATH comes before the user PATH.
    $machinePath = [string](Get-Item 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').GetValue('Path', '')
    $userPathNow = [Environment]::GetEnvironmentVariable('Path', 'User')
    $first = $null
    foreach ($dir in (($machinePath + ';' + $userPathNow) -split ';')) {
      if (-not $dir) { continue }
      $dir = [Environment]::ExpandEnvironmentVariables($dir)
      foreach ($ext in @('.exe', '.cmd', '.bat', '.ps1', '.com')) {
        $candidate = Join-Path $dir ('cc-connect' + $ext)
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $first = $candidate; break }
      }
      if ($first) { break }
    }
    $run = 'cc-connect'
    if ($first -and ($first -ine $target)) {
      Write-Host ""
      Write-Host "WARNING: in a new window, typing 'cc-connect' runs another copy first: $first"
      Write-Host "  It is an older or upstream build without the setup wizard."
      Write-Host "  Remove it (npm uninstall -g cc-connect if it came from npm); a copy on the system PATH wins over $installDir."
      Write-Host "Until then, use the full path: $target"
      $run = "& '$target'"
    }
    Write-Host ""
    Write-Host "Next: run   $run"
    Write-Host "It opens the setup wizard in your browser. Guide: https://github.com/$repo/blob/main/docs/GETTING_STARTED.md"
  } finally {
    # only the files this script made, one by one, then the (now empty) folders
    foreach ($f in @((Join-Path $tmp 'unpack\cc-connect.exe'), (Join-Path $tmp 'checksums.txt'), (Join-Path $tmp "cc-connect-$tag-windows-$arch.zip"))) {
      Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    }
    foreach ($d in @((Join-Path $tmp 'unpack'), $tmp)) {
      Remove-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue
    }
  }
}

Install-CcConnect
