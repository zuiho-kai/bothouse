[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$Packages,
    [Parameter(Mandatory = $true)][string]$PublicCertificate,
    [string]$SignTool = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$subject = 'CN=Agent Arcade Social Packaging Test'

$inputs = foreach ($package in $Packages) {
    $full = (Resolve-Path -LiteralPath $package).Path
    $target = [IO.Path]::ChangeExtension($full, '.signed.msix')
    if (Test-Path -LiteralPath $target) { throw 'The signed copy already exists.' }
    $archive = [IO.Compression.ZipFile]::OpenRead($full)
    try {
        $reader = [IO.StreamReader]::new($archive.GetEntry('AppxManifest.xml').Open())
        try { [xml]$manifest = $reader.ReadToEnd() }
        finally { $reader.Dispose() }
        if ($manifest.Package.Identity.Name -cne 'AgentArcade.Social.PackagingTest' -or
            $manifest.Package.Identity.Publisher -cne $subject -or $archive.GetEntry('AppxSignature.p7x')) {
            throw 'Use only new --mode test-signed packages, which have a unique test publisher.'
        }
    }
    finally { $archive.Dispose() }
    [pscustomobject]@{ original = $full; target = $target; version = $manifest.Package.Identity.Version }
}
if (Test-Path -LiteralPath $PublicCertificate) { throw 'Choose a new public certificate output path.' }
$publicPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PublicCertificate)
$rsa = [Security.Cryptography.RSA]::Create(2048)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new($subject, $rsa,
    [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$oids = [Security.Cryptography.OidCollection]::new()
[void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
    [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
$certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddDays(14))
$pfxFile = Join-Path ([IO.Path]::GetTempPath()) ('arcade-signing-' + [guid]::NewGuid().ToString('N') + '.pfx')
$password = [guid]::NewGuid().ToString('N')
try {
    [IO.File]::WriteAllBytes($publicPath, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    [IO.File]::WriteAllBytes($pfxFile, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))
    foreach ($item in $inputs) {
        [IO.File]::Copy($item.original, $item.target)
        try {
            & $SignTool sign /fd SHA256 /f $pfxFile /p $password $item.target | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'Test signing failed.' }
        }
        catch {
            Remove-Item -LiteralPath $item.target
            throw
        }
        $summary = [pscustomobject]@{ version = $item.version; file = $item.target;
            sha256 = (Get-FileHash -LiteralPath $item.target).Hash.ToLowerInvariant(); testCertificate = $certificate.Thumbprint }
        $summary | ConvertTo-Json | Set-Content -LiteralPath ([IO.Path]::ChangeExtension($item.target, '.receipt.json')) -Encoding utf8
        $summary
    }
}
finally {
    if (Test-Path -LiteralPath $pfxFile) { Remove-Item -LiteralPath $pfxFile }
    $certificate.Dispose()
    $rsa.Dispose()
}
