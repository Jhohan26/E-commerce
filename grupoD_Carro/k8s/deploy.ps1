<#
.SYNOPSIS
  Despliega y administra el carrito (Grupo D) en Kubernetes (Docker Desktop).

.EXAMPLE
  .\k8s\deploy.ps1                    # construye la imagen y despliega (o actualiza)
  .\k8s\deploy.ps1 -SinBuild          # despliega sin reconstruir la imagen
  .\k8s\deploy.ps1 -Accion Estado     # pods, servicios y /health
  .\k8s\deploy.ps1 -Accion Logs       # logs en vivo (Ctrl+C para salir)
  .\k8s\deploy.ps1 -Accion Detener    # apaga el pod (conserva la configuracion)
  .\k8s\deploy.ps1 -Accion Iniciar    # vuelve a encender el pod
  .\k8s\deploy.ps1 -Accion Borrar     # elimina SOLO el carrito (el namespace carrito se conserva)
#>
param(
    [ValidateSet("Desplegar", "Estado", "Logs", "Detener", "Iniciar", "Borrar")]
    [string]$Accion = "Desplegar",
    [switch]$SinBuild
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raiz del proyecto

$NS     = "carrito"
$IMAGEN = "carrito-grupod:1.0.0"                  # debe coincidir con k8s/deployment.yaml
$URL    = "http://localhost:8000"                 # puerto de k8s/service-local.yaml

# Variables que van al Secret. El resto de la configuracion esta en k8s/configmap.yaml
$CLAVES_SECRETAS = @("CLOUDAMQP_URL", "API_USUARIO", "API_PASSWORD",
                     "PRODUCTOS_USUARIO", "PRODUCTOS_PASSWORD", "JWT_SECRET")

function Run {
    & $args[0] $args[1..($args.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "Fallo: $($args -join ' ')" }
}

# Ejecuta un comando y devuelve $true/$false segun su codigo de salida (sin ensuciar la consola)
function Prueba {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $args[0] $args[1..($args.Length - 1)] *> $null; return ($LASTEXITCODE -eq 0) }
    finally { $ErrorActionPreference = $anterior }
}

function Leer-Env($ruta) {
    $d = @{}
    foreach ($linea in [IO.File]::ReadAllLines($ruta)) {      # tolera CRLF y BOM
        $t = $linea.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $d[$k] = $v
    }
    return $d
}

function Probar-Health {
    for ($i = 0; $i -lt 15; $i++) {
        try {
            $r = Invoke-RestMethod -Uri "$URL/health" -TimeoutSec 3
            if ($r.status -eq "ok") { return $true }
        } catch { Start-Sleep -Seconds 2 }
    }
    return $false
}

# ---------- Requisitos ----------
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { throw "No se encontro kubectl. Abre Docker Desktop y habilita Kubernetes." }
Run kubectl config use-context docker-desktop
if (-not (Prueba kubectl cluster-info)) { throw "El cluster no responde. En Docker Desktop: Settings > Kubernetes > Enable Kubernetes." }

# ---------- Acciones simples ----------
switch ($Accion) {
    "Estado" {
        Run kubectl -n $NS get 'deployments,pods,services' -l app=carrito
        if (Probar-Health) { Write-Host "`n/health OK en $URL" -ForegroundColor Green }
        else { Write-Host "`n/health no responde en $URL" -ForegroundColor Yellow }
        return
    }
    "Logs"    { Run kubectl -n $NS logs deployment/carrito -f --tail=100; return }
    "Detener" {
        Run kubectl -n $NS scale deployment/carrito --replicas=0
        Write-Host "Carrito detenido. Para encenderlo: .\k8s\deploy.ps1 -Accion Iniciar" -ForegroundColor Green
        return
    }
    "Iniciar" {
        Run kubectl -n $NS scale deployment/carrito --replicas=1
        Run kubectl -n $NS rollout status deployment/carrito --timeout=120s
        Write-Host "Carrito en marcha: $URL" -ForegroundColor Green
        return
    }
    "Borrar" {
        # Por etiqueta: NO se borra el namespace, porque lo comparten otros modulos
        Run kubectl -n $NS delete 'deployment,service,configmap,secret' -l app=carrito
        Write-Host "Carrito eliminado (el namespace $NS se conserva)." -ForegroundColor Green
        return
    }
}

# ---------- Desplegar ----------
if (-not (Test-Path .env)) { throw "No existe el archivo .env en la raiz del proyecto (copia .env.example y completalo)." }
$cfg = Leer-Env ".env"

if (-not $cfg["CLOUDAMQP_URL"] -or $cfg["CLOUDAMQP_URL"] -like "*USUARIO:PASSWORD*") {
    throw "CLOUDAMQP_URL falta o sigue siendo el ejemplo en .env."
}
foreach ($k in $CLAVES_SECRETAS) {
    if (-not $cfg[$k] -or $cfg[$k] -eq "CAMBIAR" -or $cfg[$k] -like "CAMBIAR_*") {
        Write-Warning "$k no esta definido en .env (o sigue en CAMBIAR): esa parte del carrito no funcionara."
    }
}

# Si el LoadBalancer aun no existe y el puerto esta ocupado, avisar antes de empezar
$existe = kubectl -n $NS get service carrito-local --ignore-not-found -o name 2>$null
if (-not $existe) {
    $ocupado = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($ocupado) {
        throw "El puerto 8000 esta ocupado (uvicorn o 'docker run' del carrito?). Detenlo, o cambia 'port' en k8s/service-local.yaml y la variable `$URL de este script."
    }
}

if (-not $SinBuild) {
    if (-not (Prueba docker info)) { throw "Docker Desktop no esta corriendo." }
    Run docker build -t $IMAGEN .
}

Run kubectl apply -f k8s/namespace.yaml

# Secret generado desde .env, solo con las claves necesarias y con saltos de linea LF
$tmp = Join-Path $env:TEMP ("carrito-secret-" + [guid]::NewGuid().ToString("N") + ".env")
try {
    $lineas = @()
    foreach ($k in $CLAVES_SECRETAS) { if ($cfg[$k]) { $lineas += "$k=$($cfg[$k])" } }
    [IO.File]::WriteAllText($tmp, (($lineas -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    kubectl -n $NS delete secret carrito-secret --ignore-not-found | Out-Null
    Run kubectl -n $NS create secret generic carrito-secret --from-env-file=$tmp
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Run kubectl -n $NS label secret carrito-secret app=carrito --overwrite

Run kubectl apply -f k8s/configmap.yaml -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/service-local.yaml

# Misma etiqueta de imagen: se reinicia para tomar el Secret / la imagen nuevos
Run kubectl -n $NS rollout restart deployment/carrito
Run kubectl -n $NS rollout status deployment/carrito --timeout=180s

Run kubectl -n $NS get 'deployments,pods,services' -l app=carrito
Write-Host ""
if (Probar-Health) {
    Write-Host "Listo:  $URL   (docs: $URL/docs)" -ForegroundColor Green
} else {
    Write-Host "El pod esta Running pero $URL aun no responde. Espera unos segundos o revisa: .\k8s\deploy.ps1 -Accion Logs" -ForegroundColor Yellow
}
