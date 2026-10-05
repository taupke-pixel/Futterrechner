# Startet einen Android-Emulator (ohne Fenster) und testet die Debug-App gegen den lokalen Firebase-Emulator.
# Vorher bauen: android\gradlew.bat assembleProbeDebug
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
$env:JAVA_HOME = (Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory | Select-Object -First 1).FullName
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME = $sdk
$adb = "$sdk\platform-tools\adb.exe"
$avd = "futterrechner_test"

if (-not ((& "$sdk\emulator\emulator.exe" -list-avds) -contains $avd)) {
  "no" | & "$sdk\cmdline-tools\latest\bin\avdmanager.bat" create avd -n $avd -k "system-images;android-35;google_apis;x86_64" -d pixel_7 | Out-Null
}
$laeuft = (& $adb devices) -match "emulator-"
if (-not $laeuft) {
  Start-Process -FilePath "$sdk\emulator\emulator.exe" -ArgumentList "-avd",$avd,"-no-window","-no-audio","-no-snapshot","-no-boot-anim","-gpu","swiftshader_indirect" -WindowStyle Hidden
  & $adb wait-for-device
  do { Start-Sleep 3; $boot = (& $adb shell getprop sys.boot_completed 2>$null) } while ($boot -notmatch "1")
}
Write-Output "Android-Emulator bereit"
& powershell -NoProfile -File (Join-Path $PSScriptRoot "emulator.ps1") "node tests/android.js"
