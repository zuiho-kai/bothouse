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
$textRect = New-Object System.Drawing.RectangleF(0, [float]($Size * 0.28), $Size, $Size)
$graphics.DrawString("b", $font, $textBrush, $textRect, $format)

# Write .ico (single 256px frame; Windows scales it) and a .png preview.
$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$pngPath = [System.IO.Path]::ChangeExtension($OutFile, ".png")
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$hIcon = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$stream = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create)
try { $icon.Save($stream) } finally { $stream.Close() }

$graphics.Dispose()
$bitmap.Dispose()
Write-Host "wrote $OutFile"
Write-Host "wrote $pngPath"
