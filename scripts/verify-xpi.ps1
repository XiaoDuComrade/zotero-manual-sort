$ErrorActionPreference = 'Stop'

$package = Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
$expectedName = "zotero-manual-sort-$($package.version).xpi"
$xpi = Get-ChildItem -Path 'build' -Filter $expectedName -Recurse |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $xpi) {
  throw "No versioned XPI named $expectedName found under build"
}

$entries = tar -tf $xpi.FullName
$normalizedEntries = $entries | ForEach-Object { $_ -replace '^\./', '' }
$manifestEntry = $entries |
  Where-Object { ($_ -replace '^\./', '') -eq 'manifest.json' } |
  Select-Object -First 1

if (-not $manifestEntry) { throw 'manifest.json is not at XPI root' }
if ($normalizedEntries -match '^addon/') { throw 'XPI contains a forbidden extra addon/ directory' }

$manifestText = tar -xOf $xpi.FullName $manifestEntry
$manifest = $manifestText | ConvertFrom-Json
if ($manifest.version -ne $package.version) {
  throw "Unexpected manifest version $($manifest.version)"
}
if (-not ($normalizedEntries -contains 'content/scripts/manualsort.js')) {
  throw 'Bundled runtime script is missing'
}
if (-not ($normalizedEntries -contains 'content/icons/mouse-click.svg')) {
  throw 'Plugin icon is missing'
}
if ($manifest.icons.'48' -ne 'content/icons/mouse-click.svg' -or
    $manifest.icons.'96' -ne 'content/icons/mouse-click.svg') {
  throw 'Plugin icon is not declared for 48px and 96px sizes'
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $xpi.FullName).Hash
[pscustomobject]@{ XPI = $xpi.FullName; Version = $manifest.version; SHA256 = $hash }
