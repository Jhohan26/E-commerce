<#
.SYNOPSIS
  Despliega y administra el modulo de Notificaciones (Grupo J) en Kubernetes (Docker Desktop).

.EXAMPLE
  .\k8s\local\deploy.ps1                    # construye la imagen y despliega (o actualiza)
  .\k8s\local\deploy.ps1 -SinBuild          # despliega sin reconstruir la imagen
  .\k8s\local\deploy.ps1 -Accion Estado     # pods, servicios y salud
  .\k8s\local\deploy.ps1 -Accion Logs       # logs en vivo (Ctrl+C para salir)
  .\k8s\local\deploy.ps1 -Accion Acceso     # crea las cuentas locales y muestra la clave de "administrador"
  .\k8s\local\deploy.ps1 -Accion Acceso -Rotar   # genera una clave nueva para "administrador"
  .\k8s\local\deploy.ps1 -Accion Detener    # apaga el pod (conserva la base de datos)
  .\k8s\local\deploy.ps1 -Accion Iniciar    # lo vuelve a encender
  .\k8s\local\deploy.ps1 -Accion Borrar     # elimina el namespace notificaciones (incluida la base de datos)
#>
param(
    [ValidateSet("Desplegar", "Estado", "Logs", "Acceso", "Detener", "Iniciar", "Borrar")]
    [string]$Accion = "Desplegar",
    [switch]$Rotar,
    [switch]$SinBuild
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))   # raiz del proyecto (k8s\local\ -> raiz)

$NS      = "notificaciones"
$IMAGEN  = "grupo-j-notificaciones:2.0.0"          # debe coincidir con k8s/local/notificaciones.yaml
$PUERTO  = 3010                                    # puerto de k8s/local/notificaciones.yaml (Service notificaciones-local)
$URL     = "http://localhost:$PUERTO"
$DIR     = "k8s/local"

# Claves del .env que NO van al Secret: los manifiestos las fijan o solo aplican a Docker Compose
$EXCLUIR_DEL_SECRET = @("PORT", "HOST_PORT", "DATABASE_PATH", "KUBECTL_BINARY", "RABBITMQ_PASSWORD")

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

# Devuelve la salida de un comando (o "" si falla), sin que un error de kubectl detenga el script
function Salida {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $r = & $args[0] $args[1..($args.Length - 1)] 2>$null; if ($LASTEXITCODE -ne 0) { return "" }; return "$r" }
    finally { $ErrorActionPreference = $anterior }
}

function Leer-Env($ruta) {
    $d = @{}
    foreach ($linea in [IO.File]::ReadAllLines($ruta)) {      # tolera CRLF y BOM (UTF-8)
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

# Lee un valor de un Secret existente (o "" si no existe)
function Leer-Secret($nombre, $clave) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $b64 = & kubectl -n $NS get secret $nombre --ignore-not-found -o "jsonpath={.data.$clave}" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $b64) { return "" }
        return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("$b64"))
    } finally { $ErrorActionPreference = $anterior }
}

# Clave aleatoria alfanumerica de 48 caracteres (JWT_SECRET exige al menos 32 bytes)
function Nueva-Clave {
    $alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return (-join ($bytes | ForEach-Object { $alfabeto[$_ % $alfabeto.Length] }))
}

function Probar-Ready {
    for ($i = 0; $i -lt 20; $i++) {
        try { return (Invoke-RestMethod -Uri "$URL/health/ready" -TimeoutSec 5) }
        catch { Start-Sleep -Seconds 2 }
    }
    return $null
}

function Mostrar-Salud($r) {
    if ($r) { Write-Host ("Servicio listo en $URL  ->  " + ($r | ConvertTo-Json -Compress)) -ForegroundColor Green }
    else { Write-Host "El servicio no responde como listo en $URL (suele ser RabbitMQ: revisa .\k8s\local\deploy.ps1 -Accion Logs)" -ForegroundColor Yellow }
}

# ---------- Requisitos ----------
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { throw "No se encontro kubectl. Abre Docker Desktop y habilita Kubernetes." }
Run kubectl config use-context docker-desktop
if (-not (Prueba kubectl cluster-info)) { throw "El cluster no responde. En Docker Desktop: Settings > Kubernetes > Enable Kubernetes." }

# ---------- Acciones simples ----------
switch ($Accion) {
    "Estado" {
        Run kubectl -n $NS get 'deployments,pods,services,pvc'
        Write-Host ""
        Mostrar-Salud (Probar-Ready)
        return
    }
    "Logs"    { Run kubectl -n $NS logs deployment/notificaciones -f --tail=100; return }
    "Acceso"  {
        # scripts/manage-access.js escribe .artifacts en el directorio actual: se ejecuta en /tmp (unica ruta escribible)
        $orden = "bootstrap"
        $objetivo = ""
        if ($Rotar) { $orden = "rotate"; $objetivo = "administrador" }
        $cmd = "cd /tmp && node /app/scripts/manage-access.js $orden $objetivo >/dev/null && cat /tmp/.artifacts/credenciales-modulos.json"
        $json = Salida kubectl -n $NS exec deployment/notificaciones -- sh -c $cmd
        if (-not $json) { throw "No se pudo ejecutar manage-access.js en el pod (esta corriendo? .\k8s\local\deploy.ps1 -Accion Estado)." }
        $cred = $json | ConvertFrom-Json
        if (-not $cred.PSObject.Properties["administrador"]) {
            Write-Host "Las cuentas ya existian y sus claves no se pueden volver a mostrar. Para una clave nueva del administrador:" -ForegroundColor Yellow
            Write-Host "  .\k8s\local\deploy.ps1 -Accion Acceso -Rotar"
            return
        }
        New-Item -ItemType Directory -Force .artifacts | Out-Null
        $dest = ".artifacts\credenciales-modulos.json"
        if (Test-Path $dest) { $dest = ".artifacts\credenciales-modulos-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json" }
        [IO.File]::WriteAllText((Join-Path (Get-Location) $dest), $json, (New-Object Text.UTF8Encoding($false)))
        Write-Host ""
        Write-Host "Interfaz web: $URL" -ForegroundColor Green
        Write-Host ("Usuario: " + $cred.administrador.usuario)
        Write-Host ("Clave:   " + $cred.administrador.password)
        Write-Host ""
        Write-Host "Guarda esa clave: no se vuelve a mostrar. Todas las credenciales nuevas quedaron en $dest (no lo subas a GitHub)." -ForegroundColor Yellow
        return
    }
    "Detener" {
        Run kubectl -n $NS scale deployment/notificaciones --replicas=0
        Write-Host "Notificaciones detenido (la base de datos se conserva). Para encenderlo: .\k8s\local\deploy.ps1 -Accion Iniciar" -ForegroundColor Green
        return
    }
    "Iniciar" {
        Run kubectl -n $NS scale deployment/notificaciones --replicas=1
        Run kubectl -n $NS rollout status deployment/notificaciones --timeout=180s
        Write-Host "Notificaciones en marcha: $URL" -ForegroundColor Green
        return
    }
    "Borrar" {
        Write-Host "Se borrara el namespace $NS COMPLETO, incluida la base de datos de Notificaciones." -ForegroundColor Yellow
        if ((Read-Host "Escribe SI para continuar") -ne "SI") { Write-Host "Cancelado."; return }
        Run kubectl delete namespace $NS
        return
    }
}

# ---------- Desplegar ----------
if (-not (Test-Path .env)) {
    throw "No existe el archivo .env en la raiz del proyecto. Copia .env.example a .env y pon en RABBITMQ_URL la URL de CloudAMQP (la misma que usan los otros modulos)."
}
$cfg = Leer-Env ".env"

if (-not $cfg["RABBITMQ_URL"] -or $cfg["RABBITMQ_URL"] -like "*localhost*") {
    throw "RABBITMQ_URL falta o apunta a localhost en .env. Dentro del cluster debe ser la URL de CloudAMQP (amqps://...)."
}
if ($cfg["USER_AUTH_MODE"] -eq "clientes") {
    if (-not $cfg["CLIENTES_JWT_ISSUER"] -or [Text.Encoding]::UTF8.GetByteCount("$($cfg['CLIENTES_JWT_SECRET'])") -lt 32) {
        throw "USER_AUTH_MODE=clientes exige CLIENTES_JWT_ISSUER y CLIENTES_JWT_SECRET (minimo 32 bytes) acordados con Clientes. Usa USER_AUTH_MODE=local mientras tanto."
    }
}
if (-not $cfg["CLIENTES_RPC_USERNAME"] -or -not $cfg["CLIENTES_RPC_PASSWORD"]) {
    Write-Warning "CLIENTES_RPC_USERNAME / CLIENTES_RPC_PASSWORD no estan en .env: no se podran consultar los datos y el correo de los clientes."
}

# JWT_SECRET: el del .env; si no hay, el que ya tiene el Secret (las sesiones lo usan); si tampoco, se genera
$jwt = $cfg["JWT_SECRET"]
if (-not $jwt) { $jwt = Leer-Secret "notificaciones-secret" "JWT_SECRET" }
if (-not $jwt) {
    $jwt = Nueva-Clave
    Write-Host "JWT_SECRET generado (se guarda solo en el Secret notificaciones-secret)." -ForegroundColor Green
}
if ([Text.Encoding]::UTF8.GetByteCount($jwt) -lt 32) { throw "JWT_SECRET en .env tiene menos de 32 bytes." }
$cfg["JWT_SECRET"] = $jwt

# Si el LoadBalancer aun no existe y el puerto esta ocupado, avisar antes de empezar
$existe = Salida kubectl -n $NS get service notificaciones-local --ignore-not-found -o name
if (-not $existe) {
    $ocupado = Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue
    if ($ocupado) {
        throw "El puerto $PUERTO esta ocupado (docker compose de Notificaciones?). Detenlo, o cambia 'port' en $DIR/notificaciones.yaml y `$PUERTO en este script."
    }
}

if (-not $SinBuild) {
    if (-not (Prueba docker info)) { throw "Docker Desktop no esta corriendo." }
    Run docker build -t $IMAGEN .
}

Run kubectl apply -f "$DIR/00-namespace.yaml"

# Secret generado desde .env (sin valores vacios: un valor vacio taparia los valores por defecto del ConfigMap)
$tmp = Join-Path $env:TEMP ("notificaciones-secret-" + [guid]::NewGuid().ToString("N") + ".env")
try {
    $lineas = @()
    foreach ($k in $cfg.Keys) {
        if ($EXCLUIR_DEL_SECRET -contains $k) { continue }
        if (-not $cfg[$k]) { continue }
        $lineas += "$k=$($cfg[$k])"
    }
    [IO.File]::WriteAllText($tmp, (($lineas -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    kubectl -n $NS delete secret notificaciones-secret --ignore-not-found | Out-Null
    Run kubectl -n $NS create secret generic notificaciones-secret --from-env-file=$tmp
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

$existia = Salida kubectl -n $NS get deployment notificaciones --ignore-not-found -o name
Run kubectl apply -f "$DIR/notificaciones.yaml"
# Misma etiqueta de imagen: si ya existia, se reinicia para tomar el Secret / la imagen nuevos
if ($existia) { Run kubectl -n $NS rollout restart deployment/notificaciones }
Run kubectl -n $NS rollout status deployment/notificaciones --timeout=240s

Run kubectl -n $NS get 'deployments,pods,services,pvc'
Write-Host ""
Mostrar-Salud (Probar-Ready)
Write-Host "Listo:  $URL   Siguiente paso: .\k8s\local\deploy.ps1 -Accion Acceso  (crea la cuenta 'administrador')" -ForegroundColor Green
