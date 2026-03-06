$ErrorActionPreference = "Stop"

$Repo = "lambda-brahman/pramana"
$InstallDir = if ($env:PRAMANA_INSTALL) { $env:PRAMANA_INSTALL } else { Join-Path $env:LOCALAPPDATA "pramana" }
$Binary = "pramana-windows-x64.exe"

if ($args.Count -gt 0) {
    $Url = "https://github.com/$Repo/releases/download/$($args[0])/$Binary"
} else {
    $Url = "https://github.com/$Repo/releases/latest/download/$Binary"
}

Write-Host "Installing pramana (windows/x64)..."

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$OutFile = Join-Path $InstallDir "pramana.exe"
$TmpFile = Join-Path $InstallDir "pramana.exe.tmp"

Invoke-WebRequest -Uri $Url -OutFile $TmpFile -UseBasicParsing

if (Test-Path $OutFile) {
    $OldFile = Join-Path $InstallDir "pramana.exe.old"
    if (Test-Path $OldFile) { Remove-Item $OldFile -Force }
    try { Remove-Item $OutFile -Force }
    catch { Rename-Item $OutFile $OldFile -Force }
}

Rename-Item $TmpFile $OutFile
Write-Host "Installed pramana to $OutFile"

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    Write-Host "Added $InstallDir to your user PATH. Restart your terminal to use 'pramana'."
}
