# Instalador de Hanzo PC: registra el componente Python en Chrome para que la extension Hanzo pueda usar apps de escritorio.
param([string]$ExtensionId = "")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostName = "com.kairos.hanzo_pc"

Write-Host ""
Write-Host "=== Instalador de Hanzo PC ===" -ForegroundColor Cyan

# 1) Python real (no el acceso directo de la Microsoft Store)
$py = $null
foreach ($cmd in @("py -3", "python")) {
  try {
    $exe = (Invoke-Expression "$cmd -c `"import sys;print(sys.executable)`"" 2>$null | Select-Object -Last 1)
    if ($exe -and (Test-Path $exe) -and ($exe -notmatch 'WindowsApps')) { $py = $exe.Trim(); break }
  } catch {}
}
if (-not $py) { Write-Host "No encontre Python. Instalalo desde python.org (marca 'Add python.exe to PATH') y vuelve a ejecutar." -ForegroundColor Red; exit 1 }
Write-Host "Python: $py"

# 2) Librerias
Write-Host "Instalando librerias (pywinauto, openpyxl, psutil)..."
& $py -m pip install --user --upgrade --quiet pywinauto openpyxl psutil
if ($LASTEXITCODE -ne 0) { Write-Host "No se pudieron instalar las librerias. Revisa tu conexion e intenta de nuevo." -ForegroundColor Red; exit 1 }
& $py -c "import pywinauto, openpyxl, psutil"
if ($LASTEXITCODE -ne 0) { Write-Host "Las librerias no cargan correctamente." -ForegroundColor Red; exit 1 }

$script = Join-Path $here "hanzo_pc.py"

# 3) ID de la extension: se detecta solo leyendo los perfiles de Chrome y Edge
$dist = Join-Path (Split-Path -Parent $here) "dist"
$ids = @()
if ($ExtensionId) { $ids = @($ExtensionId.Trim()) }
else {
  $found = & $py $script --find-ids $dist
  $ids = @($found | Where-Object { $_ -match '^[a-p]{32}$' })
}
if ($ids.Count -eq 0) {
  Write-Host "No encontre Hanzo cargada en Chrome. Cargala en chrome://extensions (Cargar descomprimida -> carpeta dist) y vuelve a ejecutar." -ForegroundColor Yellow
  $manual = Read-Host "O pega aqui el ID de Hanzo (32 letras) y pulsa Enter"
  if ($manual.Trim() -match '^[a-p]{32}$') { $ids = @($manual.Trim()) } else { Write-Host "ID no valido." -ForegroundColor Red; exit 1 }
}
Write-Host ("Extension Hanzo detectada: " + ($ids -join ", "))

# 4) Lanzador y manifiesto del host
$bat = Join-Path $here "hanzo_pc_run.bat"
Set-Content -Path $bat -Encoding ASCII -Value "@echo off`r`n`"$py`" -u `"$script`" %*"
$manifest = Join-Path $here "$hostName.json"
$json = [ordered]@{
  name = $hostName
  description = "Hanzo PC: control de apps de escritorio"
  path = $bat
  type = "stdio"
  allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json
[IO.File]::WriteAllText($manifest, $json)

# 5) Registro en Chrome (y Edge, por si lo usas)
foreach ($k in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName")) {
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty -Path $k -Name "(Default)" -Value $manifest
}

# 6) Configuracion por defecto (apps y carpetas permitidas) y primera carga de pywinauto (la mas lenta)
& $py -c "import sys; sys.path.insert(0, r'$here'); import hanzo_pc; hanzo_pc.load_config()"
Write-Host "Preparando el control de ventanas (la primera vez tarda un poco)..."
& $py $script --warmup | Out-Null

Write-Host ""
Write-Host "Listo. Hanzo PC quedo instalado." -ForegroundColor Green
Write-Host "Apps y carpetas permitidas: edita config.json en esta carpeta."
Write-Host "En chrome://extensions pulsa Recargar en Hanzo y prueba:  /pc abre el bloc de notas y escribe hola"
