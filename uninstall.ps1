$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Instalado'))
$expected = Join-Path $root 'native/com.turbovideo.downloader.json'
foreach ($browser in @('Google/Chrome','BraveSoftware/Brave-Browser','Chromium','Google/ChromeForTesting')) {
  $key = 'HKCU:/Software/' + $browser + '/NativeMessagingHosts/com.turbovideo.downloader'
  if (Test-Path -LiteralPath $key) {
    if ((Get-Item -LiteralPath $key).GetValue('') -eq $expected) { Remove-Item -LiteralPath $key }
  }
}
# Native files may be in use; keep files for explicit inspection/removal rather than recursive deletion.
Write-Host 'Registro do auxiliar removido. Seus videos foram preservados.'
Write-Host 'Remova o SirM Downloader Videos em chrome://extensions ou brave://extensions.'
Write-Host "Depois, se desejar liberar espaco, exclua esta pasta: $root"
