# Generates Polarr-branded NSIS/WiX bitmaps from public/polarr-icon.png
#
# Layout constraints (do not fight the stock wizard chrome):
# - NSIS sidebar (164x314): LEFT panel ONLY. Welcome/finish text is drawn to the
#   RIGHT on the stock light dialog — never put that copy into this bitmap.
# - NSIS header (150x57): RIGHT strip on interior pages (titles stay on the left).
# - WiX dialog (493x312): FULL welcome/finish background. Branding in the LEFT
#   ~164px; RIGHT ~2/3 must stay light so stock dark text stays readable.
# - WiX banner (493x58): Interior page top strip. Titles overlay the LEFT; keep
#   icon/wordmark on the RIGHT on a light field.
#
# BMPs are 24-bit (no alpha / color-space). 32-bit BMPs often fail in NSIS/MSI.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$desktop = Split-Path $PSScriptRoot -Parent
$iconPath = Join-Path $desktop "public\polarr-icon.png"
$outDir = Join-Path $desktop "src-tauri\installer-assets"

if (-not (Test-Path $iconPath)) {
    throw "Missing icon: $iconPath"
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bg = [System.Drawing.Color]::FromArgb(255, 9, 9, 11)
$panel = [System.Drawing.Color]::FromArgb(255, 24, 24, 27)
$text = [System.Drawing.Color]::FromArgb(255, 250, 250, 250)
$muted = [System.Drawing.Color]::FromArgb(255, 161, 161, 170)
$accent = [System.Drawing.Color]::FromArgb(255, 225, 29, 72)
$light = [System.Drawing.Color]::FromArgb(255, 250, 250, 250)
$lightEdge = [System.Drawing.Color]::FromArgb(255, 228, 228, 231)

function New-PolarrBitmap {
    param(
        [int]$Width,
        [int]$Height,
        [scriptblock]$Draw
    )
    $bmp = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    & $Draw $g $Width $Height
    $g.Dispose()
    return $bmp
}

function Save-Bmp24 {
    param($Bitmap, [string]$Path)
    # Ensure BI_RGB 24-bit DIB (System.Drawing can still emit 32bpp from some sources)
    if ($Bitmap.PixelFormat -ne [System.Drawing.Imaging.PixelFormat]::Format24bppRgb) {
        $clone = New-Object System.Drawing.Bitmap $Bitmap.Width, $Bitmap.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $cg = [System.Drawing.Graphics]::FromImage($clone)
        $cg.DrawImage($Bitmap, 0, 0, $Bitmap.Width, $Bitmap.Height)
        $cg.Dispose()
        $Bitmap.Dispose()
        $Bitmap = $clone
    }
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $Bitmap.Dispose()
}

function Draw-SidebarBrand {
    param(
        $g,
        [int]$PanelWidth,
        [int]$Height,
        [int]$IconSize,
        [string]$Tagline,
        [int]$TitleSize = 16,
        [int]$TagSize = 8
    )
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        [System.Drawing.Point]::new(0, 0),
        [System.Drawing.Point]::new(0, $Height),
        $panel, $bg
    )
    $g.FillRectangle($brush, 0, 0, $PanelWidth, $Height)
    $brush.Dispose()

    $ix = [int](($PanelWidth - $IconSize) / 2)
    $iy = 52
    $g.DrawImage($script:icon, $ix, $iy, $IconSize, $IconSize)

    $titleFont = New-Object System.Drawing.Font "Segoe UI Semibold", $TitleSize
    $tagFont = New-Object System.Drawing.Font "Segoe UI", $TagSize
    $center = New-Object System.Drawing.StringFormat
    $center.Alignment = [System.Drawing.StringAlignment]::Center
    $center.LineAlignment = [System.Drawing.StringAlignment]::Near
    $textBrush = New-Object System.Drawing.SolidBrush $text
    $mutedBrush = New-Object System.Drawing.SolidBrush $muted

    $titleTop = $iy + $IconSize + 14
    $titleRect = [System.Drawing.RectangleF]::new(8, $titleTop, ($PanelWidth - 16), 28)
    $g.DrawString("Polarr", $titleFont, $textBrush, $titleRect, $center)

    # Short underline under the wordmark (not an edge-of-bitmap stroke)
    $accentBrush = New-Object System.Drawing.SolidBrush $accent
    $underlineW = 36
    $g.FillRectangle($accentBrush, [int](($PanelWidth - $underlineW) / 2), ($titleTop + 26), $underlineW, 2)
    $accentBrush.Dispose()

    $tagRect = [System.Drawing.RectangleF]::new(10, ($titleTop + 36), ($PanelWidth - 20), 72)
    $g.DrawString($Tagline, $tagFont, $mutedBrush, $tagRect, $center)

    $titleFont.Dispose(); $tagFont.Dispose()
    $textBrush.Dispose(); $mutedBrush.Dispose(); $center.Dispose()
}

$script:icon = [System.Drawing.Image]::FromFile($iconPath)

# NSIS header — 150 x 57 (right-side strip on interior pages)
$header = New-PolarrBitmap 150 57 {
    param($g, $w, $h)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        [System.Drawing.Point]::new(0, 0),
        [System.Drawing.Point]::new($w, $h),
        $bg, $panel
    )
    $g.FillRectangle($brush, 0, 0, $w, $h)
    $brush.Dispose()
    $iconSize = 34
    $g.DrawImage($script:icon, 10, [int](($h - $iconSize) / 2), $iconSize, $iconSize)
    $font = New-Object System.Drawing.Font "Segoe UI Semibold", 13
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Near
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = New-Object System.Drawing.SolidBrush $text
    $rect = [System.Drawing.RectangleF]::new(50, 0, ($w - 56), $h)
    $g.DrawString("Polarr", $font, $textBrush, $rect, $sf)
    $accentBrush = New-Object System.Drawing.SolidBrush $accent
    $g.FillRectangle($accentBrush, 52, ($h - 12), 28, 2)
    $accentBrush.Dispose()
    $font.Dispose(); $textBrush.Dispose(); $sf.Dispose()
}
Save-Bmp24 $header (Join-Path $outDir "nsis-header.bmp")

# NSIS sidebar — 164 x 314 (welcome/finish LEFT panel only)
$sidebar = New-PolarrBitmap 164 314 {
    param($g, $w, $h)
    Draw-SidebarBrand $g $w $h 68 "Self-hosted`nmusic hub" 17 9
}
Save-Bmp24 $sidebar (Join-Path $outDir "nsis-sidebar.bmp")

# WiX banner — 493 x 58 (titles overlay LEFT; mark on RIGHT)
$wixBanner = New-PolarrBitmap 493 58 {
    param($g, $w, $h)
    $g.Clear($light)
    $edgePen = New-Object System.Drawing.Pen $lightEdge, 1
    $g.DrawLine($edgePen, 0, ($h - 1), $w, ($h - 1))
    $edgePen.Dispose()

    $iconSize = 36
    $ix = $w - $iconSize - 18
    $g.DrawImage($script:icon, $ix, [int](($h - $iconSize) / 2), $iconSize, $iconSize)
    $font = New-Object System.Drawing.Font "Segoe UI Semibold", 12
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Far
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = New-Object System.Drawing.SolidBrush $panel
    $rect = [System.Drawing.RectangleF]::new(200, 0, ($ix - 210), $h)
    $g.DrawString("Polarr", $font, $textBrush, $rect, $sf)
    $accentBrush = New-Object System.Drawing.SolidBrush $accent
    $g.FillRectangle($accentBrush, ($ix - 40), ($h - 14), 24, 2)
    $accentBrush.Dispose()
    $font.Dispose(); $textBrush.Dispose(); $sf.Dispose()
}
Save-Bmp24 $wixBanner (Join-Path $outDir "wix-banner.bmp")

# WiX dialog — 493 x 312 (LEFT brand strip; RIGHT light text field)
$wixDialog = New-PolarrBitmap 493 312 {
    param($g, $w, $h)
    $brandWidth = 164
    $g.Clear($light)
    Draw-SidebarBrand $g $brandWidth $h 72 "Self-hosted`nmusic hub" 17 9
    $edgePen = New-Object System.Drawing.Pen $lightEdge, 1
    $g.DrawLine($edgePen, $brandWidth, 0, $brandWidth, $h)
    $edgePen.Dispose()
}
Save-Bmp24 $wixDialog (Join-Path $outDir "wix-dialog.bmp")

$script:icon.Dispose()
Write-Host "Installer assets written to $outDir (24-bit BMP, MUI/WiX-safe layouts)"
