param([string]$Destination = '')
$ErrorActionPreference = 'Stop'
$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsRoot = Join-Path $mobileRoot '.tools'
if (-not $Destination) { $Destination = Join-Path $toolsRoot 'jdk21' }
$download = Join-Path $toolsRoot 'microsoft-jdk21.zip'
$checksum = '192441a9d27da813bada974bb88b4cf64d37a9589ed37f204374d411ca5ce07f'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
if (-not (Test-Path -LiteralPath $download)) {
    & curl.exe --fail --location --retry 2 --max-time 300 --output $download 'https://aka.ms/download-jdk/microsoft-jdk-21.0.12.1-windows-x64.zip'
    if ($LASTEXITCODE -ne 0) { throw 'Official JDK download failed.' }
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant() -ne $checksum) { throw 'JDK checksum mismatch. Do not execute the downloaded files.' }
Expand-Archive -LiteralPath $download -DestinationPath $Destination -Force
Get-ChildItem -LiteralPath $Destination -Directory | Select-Object FullName
