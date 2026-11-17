$hostName = "com.kairos.hanzo_pc"
foreach ($k in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName")) {
  if (Test-Path $k) { Remove-Item -Path $k -Force }
}
Write-Host "Hanzo PC desinstalado de Chrome. Puedes borrar esta carpeta." -ForegroundColor Green
