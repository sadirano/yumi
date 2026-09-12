param([Parameter(Mandatory = $true)][string]$OutDir)

# What must survive yumi that its git history does not hold: the favourites
# database, which lives outside the repo and is written in WAL mode.

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$data = Join-Path $env:LOCALAPPDATA 'sadirano-data\yumi'
$db = Join-Path $data 'favorites.sqlite'

if (-not (Test-Path $db)) {
    Write-Output "no database at $db - nothing to back up"
    exit 0
}

# sqlite's backup API rather than Copy-Item: a WAL-mode database keeps recent
# pages in favorites.sqlite-wal, and a file copy leaves them behind.
$target = Join-Path $OutDir 'favorites.sqlite'

# Copy, then prove the copy opens and is internally consistent. Reporting
# bytes alone would call a truncated file a success.
$py = @"
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
con = sqlite3.connect('file:' + src.replace('\\', '/') + '?mode=ro', uri=True)
out = sqlite3.connect(dst)
con.backup(out)
out.close()
con.close()
check = sqlite3.connect(dst)
print(check.execute('pragma integrity_check').fetchone()[0])
check.close()
"@
$verdict = ($py | python - $db $target) -join ''
if ($LASTEXITCODE -ne 0 -or $verdict -ne 'ok') {
    Write-Error "favorites.sqlite capture failed: $verdict"
    exit 1
}
Write-Output "favorites.sqlite captured ($((Get-Item $target).Length) bytes, integrity ok)"

# The uploads the user added by hand. Small, and not re-downloadable.
$uploads = Join-Path $data 'uploads'
if (Test-Path $uploads) {
    $dest = Join-Path $OutDir 'uploads'
    Copy-Item $uploads $dest -Recurse -Force -Exclude '.trash'
    $n = (Get-ChildItem $dest -Recurse -File -EA SilentlyContinue).Count
    Write-Output "uploads captured ($n files)"
}
