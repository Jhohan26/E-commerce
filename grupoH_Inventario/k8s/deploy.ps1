<#
.SYNOPSIS
  Despliega y administra el modulo de Inventario (Grupo H) en Kubernetes (Docker Desktop).

.EXAMPLE
  .\k8s\deploy.ps1                       # construye las imagenes y despliega (o actualiza)
  .\k8s\deploy.ps1 -SinBuild             # despliega sin reconstruir las imagenes
  .\k8s\deploy.ps1 -Accion Estado        # pods, servicios, salud y filas cargadas del dump
  .\k8s\deploy.ps1 -Accion Logs          # logs de la API en vivo (Ctrl+C para salir)
  .\k8s\deploy.ps1 -Accion Logs -Servicio worker
  .\k8s\deploy.ps1 -Accion Detener       # apaga API, worker y MySQL (conserva los datos)
  .\k8s\deploy.ps1 -Accion Iniciar       # los vuelve a encender
  .\k8s\deploy.ps1 -Accion Borrar        # elimina el namespace inventario (incluida la base de datos)
#>
param(
    [ValidateSet("Desplegar", "Estado", "Logs", "Detener", "Iniciar", "Borrar")]
    [string]$Accion = "Desplegar",
    [ValidateSet("api", "worker")]
    [string]$Servicio = "api",
    [switch]$SinBuild
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raiz del proyecto

$NS           = "inventario"
$IMG_APP      = "inventario-app:1.0"              # debe coincidir con k8s/inventario.yaml
$IMG_MYSQL    = "inventario-mysql:1.0"            # debe coincidir con k8s/mysql.yaml
$PUERTO       = 8005                              # puerto de k8s/inventario.yaml (Service inventario-api)
$URL          = "http://localhost:$PUERTO"
$FILAS_DUMP   = 12                                # filas de la tabla inventario en inventario_dump.sql

# Claves del .env que NO van al Secret: los manifiestos las fijan (la BD es el pod inventario-mysql)
$EXCLUIR_DEL_SECRET = @("DB_HOST", "DB_PORT", "DB_SOCKET")

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

# Cuenta las filas de inventario.inventario (o $null si todavia no se puede consultar)
function Contar-Inventario {
    $sh = "MYSQL_PWD=`$MYSQL_ROOT_PASSWORD mysql -uroot -N -e 'SELECT COUNT(*) FROM inventario.inventario'"
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $salida = & kubectl -n $NS exec inventario-mysql-0 -- sh -c $sh 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        $n = 0
        if ([int]::TryParse(("$salida").Trim(), [ref]$n)) { return $n }
        return $null
    } finally { $ErrorActionPreference = $anterior }
}

function Probar-Health {
    for ($i = 0; $i -lt 20; $i++) {
        try { return (Invoke-RestMethod -Uri "$URL/health" -TimeoutSec 5) }
        catch { Start-Sleep -Seconds 2 }
    }
    return $null
}

function Mostrar-Salud($r) {
    if (-not $r) { Write-Host "La API no responde en $URL" -ForegroundColor Yellow; return }
    $color = "Green"
    if ($r.base_de_datos -ne "ok") { $color = "Yellow" }
    Write-Host ("API: {0}  |  MySQL: {1}  |  RabbitMQ: {2}" -f $r.api, $r.base_de_datos, $r.rabbitmq) -ForegroundColor $color
}

# ---------- Requisitos ----------
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { throw "No se encontro kubectl. Abre Docker Desktop y habilita Kubernetes." }
Run kubectl config use-context docker-desktop
if (-not (Prueba kubectl cluster-info)) { throw "El cluster no responde. En Docker Desktop: Settings > Kubernetes > Enable Kubernetes." }

# ---------- Acciones simples ----------
switch ($Accion) {
    "Estado" {
        Run kubectl -n $NS get 'statefulsets,deployments,pods,services,pvc'
        Write-Host ""
        Mostrar-Salud (Probar-Health)
        $n = Contar-Inventario
        if ($null -ne $n) { Write-Host "Filas en la tabla inventario: $n (el dump trae $FILAS_DUMP)" }
        return
    }
    "Logs"    { Run kubectl -n $NS logs "deployment/inventario-$Servicio" -f --tail=100; return }
    "Detener" {
        Run kubectl -n $NS scale deployment/inventario-api deployment/inventario-worker --replicas=0
        Run kubectl -n $NS scale statefulset/inventario-mysql --replicas=0
        Write-Host "Inventario detenido (los datos se conservan). Para encenderlo: .\k8s\deploy.ps1 -Accion Iniciar" -ForegroundColor Green
        return
    }
    "Iniciar" {
        Run kubectl -n $NS scale statefulset/inventario-mysql --replicas=1
        Run kubectl -n $NS rollout status statefulset/inventario-mysql --timeout=300s
        Run kubectl -n $NS scale deployment/inventario-api deployment/inventario-worker --replicas=1
        Run kubectl -n $NS rollout status deployment/inventario-api --timeout=180s
        Run kubectl -n $NS rollout status deployment/inventario-worker --timeout=180s
        Write-Host "Inventario en marcha: $URL" -ForegroundColor Green
        return
    }
    "Borrar" {
        Write-Host "Se borrara el namespace $NS COMPLETO, incluida la base de datos de Inventario." -ForegroundColor Yellow
        if ((Read-Host "Escribe SI para continuar") -ne "SI") { Write-Host "Cancelado."; return }
        Run kubectl delete namespace $NS
        return
    }
}

# ---------- Desplegar ----------
if (-not (Test-Path .env)) { throw "No existe el archivo .env en la raiz del proyecto (copia .env.example a .env y completalo)." }
$cfg = Leer-Env ".env"

# La BD del cluster es el pod inventario-mysql: usuario root, base 'inventario' (la que crea el dump)
if (-not $cfg["DB_USER"]) { $cfg["DB_USER"] = "root" }
if ($cfg["DB_USER"] -ne "root") { throw "DB_USER en .env es '$($cfg['DB_USER'])'; la base de datos del cluster solo crea el usuario root. Usa DB_USER=root." }
if (-not $cfg["DB_NAME"]) { $cfg["DB_NAME"] = "inventario" }
if ($cfg["DB_NAME"] -ne "inventario") { throw "DB_NAME en .env es '$($cfg['DB_NAME'])', pero el dump crea la base 'inventario'. Usa DB_NAME=inventario." }
if (-not $cfg["DB_PASSWORD"]) { throw "DB_PASSWORD esta vacio en .env (se usa como clave de root de MySQL)." }
if (-not $cfg["RABBITMQ_URL"] -or $cfg["RABBITMQ_URL"] -like "*usuario:clave*" -or $cfg["RABBITMQ_URL"] -like "*localhost*") {
    throw "RABBITMQ_URL falta, es el ejemplo o apunta a localhost en .env. Dentro del cluster debe ser la URL de CloudAMQP (amqps://...)."
}
if (-not $cfg["JWT_SECRET"]) { throw "JWT_SECRET falta en .env: el worker no arranca sin el (worker_inventario.py lo exige)." }
if (-not $cfg["PRODUCTOS_RABBITMQ_URL"] -or $cfg["PRODUCTOS_RABBITMQ_URL"] -like "*usuario:clave*") {
    Write-Warning "PRODUCTOS_RABBITMQ_URL no esta definido en .env: se usara RABBITMQ_URL para consultar Productos."
}
if (-not ($cfg["PRODUCTOS_AUTH_USUARIO"] -or $cfg["AUTH_USUARIO"])) {
    Write-Warning "No hay PRODUCTOS_AUTH_USUARIO / PRODUCTOS_AUTH_PASSWORD en .env: si Productos exige JWT, el catalogo no cargara."
}

# Si el LoadBalancer aun no existe y el puerto esta ocupado, avisar antes de empezar
$existe = kubectl -n $NS get service inventario-api --ignore-not-found -o name 2>$null
if (-not $existe) {
    $ocupado = Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue
    if ($ocupado) {
        throw "El puerto $PUERTO esta ocupado (uvicorn o docker compose de Inventario?). Detenlo, o cambia 'port' en k8s/inventario.yaml y `$PUERTO en este script."
    }
}

if (-not $SinBuild) {
    if (-not (Prueba docker info)) { throw "Docker Desktop no esta corriendo." }
    Run docker build -t $IMG_APP .
    Run docker build -f Dockerfile.mysql -t $IMG_MYSQL .
    # La base de datos viaja DENTRO de la imagen de MySQL: comprobar que el dump y su importador estan
    if (-not (Prueba docker run --rm --entrypoint test $IMG_MYSQL -f /dump/inventario_dump.sql)) {
        throw "La imagen $IMG_MYSQL no contiene /dump/inventario_dump.sql (revisa Dockerfile.mysql y Dockerfile.mysql.dockerignore)."
    }
    if (-not (Prueba docker run --rm --entrypoint test $IMG_MYSQL -x /docker-entrypoint-initdb.d/10-importar-dump.sh)) {
        throw "La imagen $IMG_MYSQL no contiene el importador del dump."
    }
    Write-Host "OK: el dump esta dentro de la imagen $IMG_MYSQL" -ForegroundColor Green
}

Run kubectl apply -f k8s/00-namespace.yaml

# Secrets generados desde .env y usuarios.json, en UTF-8 sin BOM y con saltos de linea LF
$tmpEnv = Join-Path $env:TEMP ("inventario-env-" + [guid]::NewGuid().ToString("N") + ".env")
$tmpUsr = Join-Path $env:TEMP ("inventario-usuarios-" + [guid]::NewGuid().ToString("N") + ".json")
try {
    $utf8 = New-Object Text.UTF8Encoding($false)

    $lineas = @()
    foreach ($k in $cfg.Keys) { if ($EXCLUIR_DEL_SECRET -notcontains $k) { $lineas += "$k=$($cfg[$k])" } }
    [IO.File]::WriteAllText($tmpEnv, (($lineas -join "`n") + "`n"), $utf8)

    if (Test-Path usuarios.json) {
        $json = [IO.File]::ReadAllText((Resolve-Path usuarios.json).Path)
        try { $null = ConvertFrom-Json $json } catch { throw "usuarios.json no es un JSON valido." }
    } else {
        Write-Warning "No existe usuarios.json: el worker arrancara, pero inventario.login rechazara a todos. Crealo con el formato {`"usuario`": `"clave`"}."
        $json = "{}"
    }
    [IO.File]::WriteAllText($tmpUsr, $json, $utf8)

    kubectl -n $NS delete secret inventario-env inventario-usuarios --ignore-not-found | Out-Null
    Run kubectl -n $NS create secret generic inventario-env --from-env-file=$tmpEnv
    Run kubectl -n $NS create secret generic inventario-usuarios --from-file=usuarios.json=$tmpUsr
} finally {
    Remove-Item $tmpEnv, $tmpUsr -Force -ErrorAction SilentlyContinue
}

Run kubectl apply -f k8s/mysql.yaml
Run kubectl -n $NS rollout status statefulset/inventario-mysql --timeout=300s

$apiExistia = kubectl -n $NS get deployment inventario-api --ignore-not-found -o name
Run kubectl apply -f k8s/inventario.yaml
# Misma etiqueta de imagen: si ya existian, se reinician para tomar los Secrets / las imagenes nuevas
if ($apiExistia) {
    Run kubectl -n $NS rollout restart deployment/inventario-api deployment/inventario-worker
}
Run kubectl -n $NS rollout status deployment/inventario-api --timeout=180s
Run kubectl -n $NS rollout status deployment/inventario-worker --timeout=180s

Run kubectl -n $NS get 'statefulsets,deployments,pods,services'
Write-Host ""

# El dump se importa al crear el volumen por primera vez: comprobar que quedo cargado
$n = Contar-Inventario
if ($null -ne $n -and $n -ge $FILAS_DUMP) {
    Write-Host "Dump cargado: $n filas en la tabla inventario." -ForegroundColor Green
} else {
    Write-Host "No se pudo confirmar el dump (filas encontradas: $n, esperadas: $FILAS_DUMP). Revisa: kubectl -n $NS logs statefulset/inventario-mysql" -ForegroundColor Yellow
}

Mostrar-Salud (Probar-Health)
Write-Host "Listo:  $URL   (docs: $URL/docs)" -ForegroundColor Green
