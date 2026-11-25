[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$First,
    [Parameter(Mandatory = $true)][string]$Upgrade,
    [Parameter(Mandatory = $true)][string]$Receipt
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$testName = 'AgentArcade.Social.PackagingTest'
$signedPublisher = 'CN=Agent Arcade Social Packaging Test'
$unsignedPublisher = "$signedPublisher, OID.2.25.311729368913984317654407730594956997722=1"

function Read-TestPackage {
    param([string]$File)
    $full = (Resolve-Path -LiteralPath $File).Path
    $archive = [System.IO.Compression.ZipFile]::OpenRead($full)
    try {
        $reader = [System.IO.StreamReader]::new($archive.GetEntry('AppxManifest.xml').Open())
        try { [xml]$xml = $reader.ReadToEnd() }
        finally { $reader.Dispose() }
        $id = $xml.Package.Identity
        if ($id.Name -cne $testName -or $id.Publisher -cnotin @($signedPublisher, $unsignedPublisher) -or $id.ProcessorArchitecture -cne 'x64') {
            throw 'Only the distinct local packaging-test identity is allowed.'
        }
        $app = $xml.Package.Applications.Application
        if ($app.Executable -cne 'Social\AgentArcadeSocial.exe' -or $app.EntryPoint -cne 'Windows.FullTrustApplication') {
            throw 'Unexpected executable in the test package.'
        }
        if ($id.Publisher -ceq $signedPublisher -and !$archive.GetEntry('AppxSignature.p7x')) {
            throw 'Sign both test packages before the lifecycle check.'
        }
        [pscustomobject]@{ path = $full; version = [version]$id.Version; publisher = $id.Publisher;
            sha256 = (Get-FileHash -LiteralPath $full).Hash.ToLowerInvariant() }
    }
    finally { $archive.Dispose() }
}

$v1 = Read-TestPackage $First
$v2 = Read-TestPackage $Upgrade
if ($v2.version -le $v1.version) { throw 'The second MSIX must have a higher version.' }
if ($v1.publisher -cne $v2.publisher) { throw 'The two packages must use the same test publisher.' }
$testPublisher = $v1.publisher
$allowUnsigned = $testPublisher -ceq $unsignedPublisher
if (Get-AppxPackage -Name $testName) {
    throw 'This user already has the isolated test identity. No changes made.'
}

function Get-TestVersion {
    param([version]$Expected)
    $packages = @(Get-AppxPackage -Name $testName)
    if ($packages.Count -ne 1 -or $packages[0].Name -cne $testName -or
        $packages[0].Publisher -cne $testPublisher -or $packages[0].Version -ne $Expected) {
        throw "Expected exactly one registered package at $Expected."
    }
    return $packages[0]
}

$result = [ordered]@{
    identity = $testName
    version1 = $v1.version.ToString()
    version2 = $v2.version.ToString()
    sha256First = $v1.sha256
    sha256Upgrade = $v2.sha256
    installed = $false
    updated = $false
    uninstalled = $false
    appLaunched = $false
    failure = $null
}

try {
    Add-AppxPackage -Path $v1.path -AllowUnsigned:$allowUnsigned
    $initial = Get-TestVersion $v1.version
    $result.installed = $true
    Add-AppxPackage -Path $v2.path -AllowUnsigned:$allowUnsigned
    $updated = Get-TestVersion $v2.version
    if ($updated.PackageFamilyName -cne $initial.PackageFamilyName) { throw 'The package family changed during update.' }
    $result.updated = $true
    $result.packageFamily = $updated.PackageFamilyName
    Remove-AppxPackage -Package $updated.PackageFullName
    if (Get-AppxPackage -Name $testName) { throw 'Package is still registered for this user.' }
    $result.uninstalled = $true
}
catch {
    $result.failure = $_.Exception.Message
    $result.errorId = $_.FullyQualifiedErrorId
    throw
}
finally {
    try {
        foreach ($item in @(Get-AppxPackage -Name $testName)) {
            if ($item.Name -ceq $testName -and $item.Publisher -ceq $testPublisher -and
                $item.Version -in @($v1.version, $v2.version)) {
                Remove-AppxPackage -Package $item.PackageFullName
            }
        }
    }
    catch { $result.cleanupError = $_.Exception.Message }
    $result.remainingForCurrentUser = @((Get-AppxPackage -Name $testName)).Count
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Receipt -Encoding utf8
}
