Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedRectPath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

$size = 512
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

# Rounded gradient tile
$background = New-RoundedRectPath -X 16 -Y 16 -Width 480 -Height 480 -Radius 112
$backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(24, 24),
    [System.Drawing.PointF]::new(488, 488),
    [System.Drawing.Color]::FromArgb(255, 37, 99, 235),
    [System.Drawing.Color]::FromArgb(255, 14, 165, 233)
)
$g.FillPath($backgroundBrush, $background)
$g.SetClip($background)

# Soft highlight in the upper-left corner
$sheen = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(60, 20),
    [System.Drawing.PointF]::new(340, 300),
    [System.Drawing.Color]::FromArgb(48, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255)
)
$g.FillEllipse($sheen, -80, -140, 520, 430)
$g.ResetClip()

# Soft shadow under the folder
$shadowPath = New-RoundedRectPath -X 128 -Y 186 -Width 272 -Height 206 -Radius 34
$shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(32, 15, 23, 42))
$g.FillPath($shadowBrush, $shadowPath)

# Folder back and tab
$tabPath = New-RoundedRectPath -X 120 -Y 168 -Width 158 -Height 82 -Radius 22
$tabBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(225, 255, 255, 255))
$g.FillPath($tabBrush, $tabPath)

$bodyPath = New-RoundedRectPath -X 120 -Y 194 -Width 272 -Height 192 -Radius 30
$bodyBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
$g.FillPath($bodyBrush, $bodyPath)

# Folder front flap with a subtle cool tint
$flapPath = New-RoundedRectPath -X 120 -Y 238 -Width 272 -Height 148 -Radius 28
$flapBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 238),
    [System.Drawing.PointF]::new(0, 386),
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(255, 224, 238, 255)
)
$g.FillPath($flapBrush, $flapPath)

$flapEdge = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(45, 30, 64, 175), 2.0)
$g.DrawPath($flapEdge, $flapPath)

# Download badge
$badgePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$badgePath.AddEllipse(292, 286, 156, 156)
$badgeBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(300, 290),
    [System.Drawing.PointF]::new(444, 438),
    [System.Drawing.Color]::FromArgb(255, 15, 23, 42),
    [System.Drawing.Color]::FromArgb(255, 30, 64, 175)
)
$g.FillPath($badgeBrush, $badgePath)

$badgeRing = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 255, 255, 255), 3.0)
$g.DrawEllipse($badgeRing, 292, 286, 156, 156)

# Arrow inside the badge
$arrowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 30.0)
$arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawLine($arrowPen, 370, 322, 370, 394)
$g.DrawLine($arrowPen, 338, 364, 370, 396)
$g.DrawLine($arrowPen, 402, 364, 370, 396)

# Export the icon sizes Chrome expects
$imageFormat = [System.Drawing.Imaging.ImageFormat]::Png
foreach ($targetSize in @(16, 32, 48, 128)) {
    $resized = [System.Drawing.Bitmap]::new($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $resizeGraphics = [System.Drawing.Graphics]::FromImage($resized)
    $resizeGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizeGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $resizeGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $resizeGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $resizeGraphics.DrawImage($bitmap, 0, 0, $targetSize, $targetSize)
    $resized.Save((Join-Path $outDir "icon$targetSize.png"), $imageFormat)
    $resizeGraphics.Dispose()
    $resized.Dispose()
}

# A larger preview is handy when iterating on the artwork.
$bitmap.Save((Join-Path $outDir 'icon512.png'), $imageFormat)

$g.Dispose()
$bitmap.Dispose()
$backgroundBrush.Dispose()
$sheen.Dispose()
$tabBrush.Dispose()
$shadowBrush.Dispose()
$shadowPath.Dispose()
$tabPath.Dispose()
$bodyBrush.Dispose()
$bodyPath.Dispose()
$flapBrush.Dispose()
$flapPath.Dispose()
$flapEdge.Dispose()
$badgeBrush.Dispose()
$badgePath.Dispose()
$badgeRing.Dispose()
$arrowPen.Dispose()
$background.Dispose()

Write-Host "Icons written to $outDir"
