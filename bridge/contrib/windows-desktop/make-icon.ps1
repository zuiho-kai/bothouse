# Generate a bothouse desktop icon locally (no binary asset is committed).
# This is a plain-text script so the icon can be reviewed by reading the code:
# dark rounded square + green dot + white "b".
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\make-icon.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\make-icon.ps1 -OutFile D:\icons\bothouse.ico
param(
    [string]$OutFile = (Join-Path $PSScriptRoot "bothouse.ico"),
    [int]$Size = 256
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

# Rounded dark square background.
$margin = [int]($Size * 0.05)
$radius = [int]($Size * 0.22)
$diameter = $radius * 2
$outline = New-Object System.Drawing.Drawing2D.GraphicsPath
$outline.AddArc($margin, $margin, $diameter, $diameter, 180, 90)
$outline.AddArc($Size - $margin - $diameter, $margin, $diameter, $diameter, 270, 90)
$outline.AddArc($Size - $margin - $diameter, $Size - $margin - $diameter, $diameter, $diameter, 0, 90)
$outline.AddArc($margin, $Size - $margin - $diameter, $diameter, $diameter, 90, 90)
$outline.CloseFigure()
$background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 17, 19, 22))
$graphics.FillPath($background, $outline)

# Green dot (echoes the bothouse UI accent).
$dotSize = [int]($Size * 0.14)
$dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 46, 204, 113))
$graphics.FillEllipse($dotBrush, [int](($Size - $dotSize) / 2), [int]($Size * 0.13), $dotSize, $dotSize)

# White "b".
$font = New-Object System.Drawing.Font("Segoe UI", [float]($Size * 0.58), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 247, 250))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, [float]($Size * 0.24), $Size, [float]($Size * 0.70))
$graphics.DrawString("b", $font, $textBrush, $textRect, $format)

# Write .ico (one 32-bit BGRA frame with alpha) and a .png preview.
# Icon.FromHandle(GetHicon()).Save() would write a 16-colour (4-bit) icon, so the frame is written directly.
$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$pngPath = [System.IO.Path]::ChangeExtension($OutFile, ".png")
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
$data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$rowBytes = $Size * 4
$pixels = New-Object byte[] ($rowBytes * $Size)
for ($y = 0; $y -lt $Size; $y++) {
    # ICO bitmaps are stored bottom-up.
    [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $pixels, ($Size - 1 - $y) * $rowBytes, $rowBytes)
}
$bitmap.UnlockBits($data)
$maskBytes = [int]([Math]::Ceiling($Size / 32.0) * 4) * $Size
$imageBytes = 40 + $pixels.Length + $maskBytes
$dim = if ($Size -ge 256) { 0 } else { $Size }
$stream = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
    $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
    $writer.Write([byte]$dim); $writer.Write([byte]$dim); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$imageBytes); $writer.Write([UInt32]22)
    $writer.Write([UInt32]40); $writer.Write([Int32]$Size); $writer.Write([Int32]($Size * 2))
    $writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]0); $writer.Write([UInt32]($pixels.Length + $maskBytes))
    $writer.Write([Int32]0); $writer.Write([Int32]0); $writer.Write([UInt32]0); $writer.Write([UInt32]0)
    $writer.Write($pixels)
    $writer.Write((New-Object byte[] $maskBytes))
} finally { $writer.Close() }

$graphics.Dispose()
$bitmap.Dispose()
Write-Host "wrote $OutFile"
Write-Host "wrote $pngPath"
