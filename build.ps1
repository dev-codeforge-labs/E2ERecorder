param(
    [string]$Root = $PSScriptRoot,
    [string]$Dist = (Join-Path $PSScriptRoot "dist"),
    [string]$Name = "e2e-recorder-v2.xpi"
)

$ErrorActionPreference = "Stop"

$xpi    = Join-Path $Dist $Name
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$xpiTmp = Join-Path $Dist "e2e-recorder-v2.$stamp.tmp.xpi"

Write-Host "[E2E Recorder] Building XPI..."

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
# Clean up old tmp files that are no longer locked
Get-ChildItem $Dist -Filter "*.tmp.xpi" | ForEach-Object {
    try { Remove-Item $_.FullName -Force -ErrorAction Stop; Write-Host "  Removed old: $($_.Name)" } catch {}
}

Add-Type -Assembly System.IO.Compression
Add-Type -Assembly System.IO.Compression.FileSystem

$zip   = [System.IO.Compression.ZipFile]::Open($xpiTmp, [System.IO.Compression.ZipArchiveMode]::Create)
$level = [System.IO.Compression.CompressionLevel]::Optimal

$items = @("manifest.json","background.js","content.js","popup.html","popup.css","popup.js","README.md","modules","icons")

foreach ($item in $items) {
    $src = Join-Path $Root $item
    if (Test-Path $src -PathType Leaf) {
        $entry       = $zip.CreateEntry($item, $level)
        $entryStream = $entry.Open()
        $fileStream  = [System.IO.File]::OpenRead($src)
        $fileStream.CopyTo($entryStream)
        $fileStream.Dispose()
        $entryStream.Dispose()
    } elseif (Test-Path $src -PathType Container) {
        Get-ChildItem $src -Recurse -File | ForEach-Object {
            $entryName   = $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
            $entry       = $zip.CreateEntry($entryName, $level)
            $entryStream = $entry.Open()
            $fileStream  = [System.IO.File]::OpenRead($_.FullName)
            $fileStream.CopyTo($entryStream)
            $fileStream.Dispose()
            $entryStream.Dispose()
        }
    }
}

$zip.Dispose()

try {
    if (Test-Path $xpi) { Remove-Item $xpi -Force }
    Rename-Item $xpiTmp $Name
    $sizeKB = [math]::Round((Get-Item $xpi).Length / 1024, 1)
    Write-Host "[E2E Recorder] XPI ready: $xpi  ($sizeKB KB)"
} catch {
    Write-Warning "Could not overwrite final XPI - Firefox may have it locked."
    Write-Warning "Load this file in Firefox: $xpiTmp"
    $sizeKB = [math]::Round((Get-Item $xpiTmp).Length / 1024, 1)
    Write-Host "[E2E Recorder] XPI tmp ready: $xpiTmp  ($sizeKB KB)"
}
