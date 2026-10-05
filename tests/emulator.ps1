# Startet einen Test im Firebase-Emulator (nie gegen ein echtes Projekt).
# Beispiel:  powershell -File tests\emulator.ps1 "node tests/vergleich.js"
param([string]$Befehl = "node tests/vergleich.js")
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
# Reste eines abgebrochenen Laufs beenden
Get-NetTCPConnection -LocalPort 8080,9099,9150,4400,4500 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Set-Location (Join-Path $PSScriptRoot "..")
firebase emulators:exec --only auth,firestore --project demo-futterrechner $Befehl 2>&1 |
  Where-Object { $_ -notmatch "^\s*(i|\+|!)\s" -and $_ -notmatch "^\s*$" }
exit $LASTEXITCODE
