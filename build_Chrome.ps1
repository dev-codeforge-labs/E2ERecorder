param(
    [string]$Root = $PSScriptRoot,
    [string]$Dist = (Join-Path $PSScriptRoot "dist"),
    [string]$Name = "e2e-recorder-v2-chrome.zip"
)

$ErrorActionPreference = "Stop"

$zip_final = Join-Path $Dist $Name
$stamp     = Get-Date -Format "yyyyMMdd-HHmmss"
$zip_tmp   = Join-Path $Dist ("e2e-recorder-chrome." + $stamp + ".tmp.zip")

Write-Host "[E2E Recorder] Building Chrome ZIP..."

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
Get-ChildItem $Dist -Filter "e2e-recorder-chrome.*.tmp.zip" | ForEach-Object {
    try { Remove-Item $_.FullName -Force -ErrorAction Stop; Write-Host ("  Removed old: " + $_.Name) } catch {}
}

Add-Type -Assembly System.IO.Compression
Add-Type -Assembly System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($zip_tmp, [System.IO.Compression.ZipArchiveMode]::Create)
$level   = [System.IO.Compression.CompressionLevel]::Optimal

function AddFile($arc, $lvl, $srcPath, $entryName) {
    $entry       = $arc.CreateEntry($entryName, $lvl)
    $entryStream = $entry.Open()
    $fileStream  = [System.IO.File]::OpenRead($srcPath)
    $fileStream.CopyTo($entryStream)
    $fileStream.Dispose()
    $entryStream.Dispose()
}

# Pack manifest_chrome.json as manifest.json inside the ZIP
AddFile $archive $level (Join-Path $Root "manifest_chrome.json") "manifest.json"

# Pack the rest of the extension files
$items = @("background.js","content.js","popup.html","popup.css","popup.js","README.md","modules","icons")

foreach ($item in $items) {
    $src = Join-Path $Root $item
    if (Test-Path $src -PathType Leaf) {
        AddFile $archive $level $src $item
    } elseif (Test-Path $src -PathType Container) {
        Get-ChildItem $src -Recurse -File | ForEach-Object {
            $entryName = $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
            AddFile $archive $level $_.FullName $entryName
        }
    }
}

$archive.Dispose()

try {
    if (Test-Path $zip_final) { Remove-Item $zip_final -Force }
    Rename-Item $zip_tmp $Name
    $sz = [math]::Round((Get-Item $zip_final).Length / 1024, 1)
    Write-Host ("[E2E Recorder] Chrome ZIP ready: " + $zip_final + "  (" + $sz + " kb)")
    Write-Host ""
    Write-Host "To load in Chrome:"
    Write-Host "  1. Unzip to a folder, e.g.: dist\chrome\"
    Write-Host "  2. Open chrome://extensions"
    Write-Host "  3. Enable Developer mode (top-right toggle)"
    Write-Host "  4. Click 'Load unpacked' and select that folder"
    Write-Host ""
    Write-Host "  OR upload the ZIP directly to the Chrome Web Store."
} catch {
    $sz = [math]::Round((Get-Item $zip_tmp).Length / 1024, 1)
    Write-Warning "Could not rename ZIP. Use this file instead:"
    Write-Host ("  " + $zip_tmp + "  (" + $sz + " kb)")
}
