[CmdletBinding()]
param(
  [string]$InstallRoot,
  [string]$DownloadDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads/TurboVideo'),
  [switch]$SkipRegistration,
  [switch]$NoOpen,
  [string]$StoreExtensionId
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'SirM-Downloader-Videos-Installer/1.0.8' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
if (-not $InstallRoot) { $InstallRoot = Join-Path $PSScriptRoot 'Instalado' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$bin = Join-Path $InstallRoot 'bin'
$native = Join-Path $InstallRoot 'native'
$cache = Join-Path $InstallRoot 'cache'
foreach ($directory in @($InstallRoot,$bin,$native,$cache,$DownloadDirectory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
function Save-Verified([string]$Url, [string]$Destination, [string]$Hash) {
  if ($Hash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Hash de download invalido.' }
  if ((Test-Path -LiteralPath $Destination) -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Hash) { return }
  Write-Host "Baixando $([IO.Path]::GetFileName($Destination))..."
  Invoke-WebRequest -Uri $Url -OutFile "$Destination.part" -Headers $headers -TimeoutSec 300 -UseBasicParsing
  if ((Get-FileHash -LiteralPath "$Destination.part" -Algorithm SHA256).Hash -ne $Hash) { throw "SHA-256 nao confere: $Destination.part" }
  Move-Item -LiteralPath "$Destination.part" -Destination $Destination -Force
}
function Extract-Binary([string]$Archive, [string]$Name, [string]$Destination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $entry = $zip.Entries | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
    if (-not $entry) { throw "Binario ausente no pacote: $Name" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$Destination,$true)
  } finally { $zip.Dispose() }
}
# Reuse an installed Node 22+, otherwise obtain a verified portable LTS runtime.
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if ($node) { $major = & $node -p 'parseInt(process.versions.node)'; if ($LASTEXITCODE -ne 0 -or [int]$major -lt 22) { $node = $null } }
if (-not $node) {
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -Headers $headers
  $version = ($index | Where-Object { $_.version -like 'v22.*' -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1).version
  if (-not $version) { throw 'Nao foi possivel localizar Node.js LTS.' }
  $name = "node-$version-win-x64.zip"
  $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt" -Headers $headers -UseBasicParsing).Content
  $line = ($sums -split "`n" | Where-Object { $_.Trim().EndsWith("  $name") } | Select-Object -First 1)
  $sha = ($line.Trim() -split '\s+')[0]
  $archive = Join-Path $cache $name
  Save-Verified "https://nodejs.org/dist/$version/$name" $archive $sha
  $node = Join-Path $bin 'node.exe'
  Extract-Binary $archive 'node.exe' $node
}
# yt-dlp release assets carry a SHA-256 digest from GitHub's release API.
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers $headers
$asset = $release.assets | Where-Object { $_.name -eq 'yt-dlp.exe' } | Select-Object -First 1
if (-not $asset.digest -or $asset.digest -notlike 'sha256:*') { throw 'Release do yt-dlp sem SHA-256 verificavel.' }
$ytdlp = Join-Path $bin 'yt-dlp.exe'
Save-Verified $asset.browser_download_url $ytdlp $asset.digest.Substring(7)
$aria2 = Join-Path $bin 'aria2c.exe'
$ariaZip = Join-Path $cache 'aria2-1.37.0-win-64bit-build1.zip'
# SHA-256 from Microsoft's winget-pkgs aria2.aria2 1.37.0 x64 manifest.
Save-Verified 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip' $ariaZip '67D015301EEF0B612191212D564C5BB0A14B5B9C4796B76454276A4D28D9B288'
Extract-Binary $ariaZip 'aria2c.exe' $aria2
$ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $ffmpeg = Join-Path $bin 'ffmpeg.exe'
  $ffRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest' -Headers $headers
  $ffAsset = $ffRelease.assets | Where-Object { $_.name -eq 'ffmpeg-master-latest-win64-gpl.zip' } | Select-Object -First 1
  if (-not $ffAsset.digest -or $ffAsset.digest -notlike 'sha256:*') { throw 'Release do FFmpeg sem SHA-256 verificavel.' }
  $archive = Join-Path $cache 'ffmpeg-win64.zip'
  Save-Verified $ffAsset.browser_download_url $archive $ffAsset.digest.Substring(7)
  Extract-Binary $archive 'ffmpeg.exe' $ffmpeg
  Extract-Binary $archive 'ffprobe.exe' (Join-Path $bin 'ffprobe.exe')
}
$extensionId = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extension-id.txt') -Raw).Trim()
if ($extensionId -notmatch '^[a-p]{32}$') { throw 'ID da extensao invalido.' }
# The Chrome Web Store assigns its own ID; accept it alongside the unpacked (key-pinned) ID.
$storeIdFile = Join-Path $PSScriptRoot 'store-extension-id.txt'
$storeId = if ($StoreExtensionId) { $StoreExtensionId } elseif (Test-Path -LiteralPath $storeIdFile) { (Get-Content -LiteralPath $storeIdFile -Raw).Trim() } else { '' }
if ($storeId -and $storeId -notmatch '^[a-p]{32}$') { throw 'ID da extensao da loja invalido.' }
$extensionIds = @($extensionId) + @($storeId | Where-Object { $_ -and $_ -ne $extensionId })
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native/core.mjs'),(Join-Path $PSScriptRoot 'native/host.mjs') -Destination $native -Force
$extensionPath = Join-Path $PSScriptRoot 'extension'
if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json'))) { throw 'Extraia o ZIP inteiro antes de executar Instalar.cmd.' }
$config = @{ node=$node; ytdlp=$ytdlp; ffmpeg=$ffmpeg; aria2=$aria2; output=[IO.Path]::GetFullPath($DownloadDirectory); extensionId=$extensionId; extensionIds=@($extensionIds) }
[IO.File]::WriteAllText((Join-Path $native 'config.json'),($config | ConvertTo-Json),$utf8)
$hostScript = Join-Path $native 'host.mjs'
$launcher = "@echo off`r`n@chcp 65001 >nul`r`n`"$node`" `"$hostScript`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $native 'host.cmd'),$launcher,$utf8)
$hostManifest = @{ name='com.turbovideo.downloader'; description='SirM Downloader Videos local downloader'; path=(Join-Path $native 'host.cmd'); type='stdio'; allowed_origins=@($extensionIds | ForEach-Object { "chrome-extension://$_/" }) }
$manifestPath = Join-Path $native 'com.turbovideo.downloader.json'
[IO.File]::WriteAllText($manifestPath,($hostManifest | ConvertTo-Json),$utf8)
if (-not $SkipRegistration) {
  foreach ($browser in @('Google/Chrome','BraveSoftware/Brave-Browser','Chromium','Google/ChromeForTesting')) {
    $key = 'HKCU:/Software/' + $browser + '/NativeMessagingHosts/com.turbovideo.downloader'
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $manifestPath
  }
}
Write-Host ''
Write-Host 'SirM Downloader Videos: auxiliar instalado. Ative ou recarregue a extensao no navegador:' -ForegroundColor Green
Write-Host '1. Abra chrome://extensions ou brave://extensions'
Write-Host '2. Ative Modo do desenvolvedor e clique em Carregar sem compactacao.'
Write-Host "3. Selecione esta pasta: $extensionPath"
Write-Host '4. Na pagina com o video, clique no icone do SirM Downloader Videos.'
Write-Host "Destino dos downloads: $DownloadDirectory"
Write-Host 'A pasta Downloads/TurboVideo existente e seus videos permanecem preservados.'
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'PASTA-DA-EXTENSAO.txt'),$extensionPath,$utf8)
Write-Host 'Mantenha a pasta extraida neste local. Se a mover, execute Instalar.cmd novamente.'
if (-not $NoOpen) { Start-Process -FilePath explorer.exe -ArgumentList ('"' + $extensionPath + '"') }
