param(
  [Parameter(Mandatory = $true)]
  [string]$SourceZip,
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$source = [IO.Path]::GetFullPath($SourceZip)
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Source archive not found: $source"
}

$resourcesRoot = Join-Path $ProjectRoot "resources"
$archiveRoot = Join-Path $resourcesRoot "archive"
$extractRoot = Join-Path $resourcesRoot "source-pack"

if ((Test-Path -LiteralPath $extractRoot) -and
    (Get-ChildItem -LiteralPath $extractRoot -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
  throw "Refusing to overwrite an existing source pack: $extractRoot"
}

New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

$archiveCopy = Join-Path $archiveRoot ([IO.Path]::GetFileName($source))
if (Test-Path -LiteralPath $archiveCopy) {
  throw "Refusing to overwrite the archived source ZIP: $archiveCopy"
}
Copy-Item -LiteralPath $source -Destination $archiveCopy

$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$copyHash = (Get-FileHash -LiteralPath $archiveCopy -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne $copyHash) {
  throw "Archive copy hash mismatch."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archiveCopy)
$rootFull = [IO.Path]::GetFullPath($extractRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$entries = @()

try {
  foreach ($entry in $archive.Entries) {
    $relative = $entry.FullName.Replace("\", [IO.Path]::DirectorySeparatorChar).Replace("/", [IO.Path]::DirectorySeparatorChar)
    if ([string]::IsNullOrWhiteSpace($relative)) { continue }
    if ([IO.Path]::IsPathRooted($relative)) { throw "Rooted archive path rejected: $relative" }

    $target = [IO.Path]::GetFullPath((Join-Path $extractRoot $relative))
    if (-not $target.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Archive path traversal rejected: $relative"
    }

    if ([string]::IsNullOrEmpty($entry.Name)) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      continue
    }

    $targetDirectory = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    $inputStream = $entry.Open()
    try {
      $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally {
      $inputStream.Dispose()
    }

    $entries += [pscustomobject]@{
      path = $relative.Replace([IO.Path]::DirectorySeparatorChar, "/")
      size = $entry.Length
      sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
} finally {
  $archive.Dispose()
}

$manifest = [ordered]@{
  sourceArchive = [IO.Path]::GetFileName($archiveCopy)
  sourceSha256 = $sourceHash
  importedAt = (Get-Date).ToUniversalTime().ToString("o")
  entryCount = $entries.Count
  entries = $entries
}

$manifestPath = Join-Path $resourcesRoot "import-manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

Write-Output "Imported $($entries.Count) files."
Write-Output "Archive SHA256: $sourceHash"
Write-Output "Source pack: $extractRoot"
