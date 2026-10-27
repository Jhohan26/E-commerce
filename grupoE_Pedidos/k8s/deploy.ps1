<#
.SYNOPSIS
  Despliega y administra el modulo de Pedidos (Grupo E) en Kubernetes (Docker Desktop).

.EXAMPLE
  .\k8s\deploy.ps1                    # construye la imagen y despliega (o actualiza)
  .\k8s\deploy.ps1 -SinBuild          # despliega sin reconstruir la imagen
  .\k8s\deploy.ps1 -Accion Estado     # pods, servicios, salud y pedidos cargados
  .\k8s\deploy.ps1 -Accion Logs       # logs en vivo (Ctrl+C para salir)
  .\k8s\deploy.ps1 -Accion Detener    # apaga web y MySQL (conserva los datos)
  .\k8s\deploy.ps1 -Accion Iniciar    # los vuelve a encender
  .\k8s\deploy.ps1 -Accion Borrar     # elimina el namespace pedidos (incluida la base de datos)
#>
param(
    [ValidateSet("Desplegar", "Estado", "Logs", "Detener", "Iniciar", "Borrar")]
    [string]$Accion = "Desplegar",
    [switch]$SinBuild
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raiz del proyecto

$NS     = "pedidos"
$IMAGEN = "pedidos:lab-jwt-v1"                    # debe coincidir con k8s/pedidos.yaml
$PUERTO = 3001                                    # puerto de k8s/pedidos.yaml (Service pedidos-web)
$URL    = "http://localhost:$PUERTO"
$PEDIDOS_EN_DUMP = 25                             # pedidos que trae database/schema.sql

# Variables que van al Secret. El resto esta en el ConfigMap de k8s/pedidos.yaml
$CLAVES_SECRETAS = @("DB_USER", "DB_PASSWORD", "RABBITMQ_URL", "JWT_SECRET",
                     "CLIENTES_RPC_PASSWORD", "INVENTARIO_RPC_PASSWORD", "PRODUCTOS_RPC_PASSWORD")

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

# Cuenta los pedidos que hay en MySQL (o $null si todavia no se puede consultar)
function Contar-Pedidos {
    $sh = "MYSQL_PWD=`$MYSQL_ROOT_PASSWORD mysql -uroot -N -e 'SELECT COUNT(*) FROM pedidos_db.pedidos'"
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $salida = & kubectl -n $NS exec pedidos-mysql-0 -- sh -c $sh 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        $n = 0
        if ([int]::TryParse(("$salida").Trim(), [ref]$n)) { return $n }
        return $null
    } finally { $ErrorActionPreference = $anterior }
}

function Probar-Health {
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $r = Invoke-RestMethod -Uri "$URL/api/health" -TimeoutSec 5
            return $r
        } catch { Start-Sleep -Seconds 2 }
    }
    return $null
}

function Mostrar-Salud($r) {
    if (-not $r) { Write-Host "La API no responde en $URL" -ForegroundColor Yellow; return }
    $color = "Green"
    if ($r.status -ne "OK") { $color = "Yellow" }
    Write-Host ("API {0}  |  MySQL conectado: {1}  |  RabbitMQ conectado: {2}" -f $r.status, $r.mysql.connected, $r.rabbitmq.connected) -ForegroundColor $color
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
        $n = Contar-Pedidos
        if ($null -ne $n) { Write-Host "Pedidos en la base de datos: $n" }
        return
    }
    "Logs"    { Run kubectl -n $NS logs deployment/pedidos-web -f --tail=100; return }
    "Detener" {
        Run kubectl -n $NS scale deployment/pedidos-web --replicas=0
        Run kubectl -n $NS scale statefulset/pedidos-mysql --replicas=0
        Write-Host "Pedidos detenido (los datos se conservan). Para encenderlo: .\k8s\deploy.ps1 -Accion Iniciar" -ForegroundColor Green
        return
    }
    "Iniciar" {
        Run kubectl -n $NS scale statefulset/pedidos-mysql --replicas=1
        Run kubectl -n $NS rollout status statefulset/pedidos-mysql --timeout=300s
        Run kubectl -n $NS scale deployment/pedidos-web --replicas=1
        Run kubectl -n $NS rollout status deployment/pedidos-web --timeout=180s
        Write-Host "Pedidos en marcha: $URL" -ForegroundColor Green
        return
    }
    "Borrar" {
        Write-Host "Se borrara el namespace $NS COMPLETO, incluida la base de datos de Pedidos." -ForegroundColor Yellow
        if ((Read-Host "Escribe SI para continuar") -ne "SI") { Write-Host "Cancelado."; return }
        Run kubectl delete namespace $NS
        return
    }
}

# ---------- Desplegar ----------
if (-not (Test-Path .env)) { throw "No existe el archivo .env en la raiz del proyecto (copia .env.example y completalo)." }
$cfg = Leer-Env ".env"

# Dentro del cluster, MySQL es el pod pedidos-mysql: el usuario tiene que ser root (el de la imagen de MySQL)
if (-not $cfg["DB_USER"]) { $cfg["DB_USER"] = "root" }
if ($cfg["DB_USER"] -ne "root") { throw "DB_USER en .env es '$($cfg['DB_USER'])'; la base de datos del cluster solo crea el usuario root. Usa DB_USER=root." }
if (-not $cfg["DB_PASSWORD"] -or $cfg["DB_PASSWORD"] -like "tu_contrase*") { throw "DB_PASSWORD falta en .env (se usa como clave de root de MySQL)." }
if (-not $cfg["RABBITMQ_URL"] -or $cfg["RABBITMQ_URL"] -like "*localhost*") {
    throw "RABBITMQ_URL falta o apunta a localhost en .env. Dentro del cluster debe ser la URL de CloudAMQP (amqps://...)."
}
foreach ($k in @("JWT_SECRET", "CLIENTES_RPC_PASSWORD", "INVENTARIO_RPC_PASSWORD", "PRODUCTOS_RPC_PASSWORD")) {
    if (-not $cfg[$k] -or $cfg[$k] -like "reemplazar_*") {
        Write-Warning "$k no esta definido en .env: esa parte de Pedidos no funcionara."
    }
}

# Si el LoadBalancer aun no existe y el puerto esta ocupado, avisar antes de empezar
$existe = kubectl -n $NS get service pedidos-web --ignore-not-found -o name 2>$null
if (-not $existe) {
    $ocupado = Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue
    if ($ocupado) {
        throw "El puerto $PUERTO esta ocupado. Libera ese puerto o cambia 'port' en k8s/pedidos.yaml y `$PUERTO en este script."
    }
}

if (-not $SinBuild) {
    if (-not (Prueba docker info)) { throw "Docker Desktop no esta corriendo." }
    Run docker build -t $IMAGEN .
    # El dump viaja DENTRO de la imagen: la app lo carga en MySQL al arrancar si la tabla pedidos esta vacia
    if (-not (Prueba docker run --rm --entrypoint test $IMAGEN -f /app/database/schema.sql)) {
        throw "La imagen no contiene /app/database/schema.sql (revisa el Dockerfile y .dockerignore)."
    }
    Write-Host "OK: database/schema.sql esta dentro de la imagen $IMAGEN" -ForegroundColor Green
}

Run kubectl apply -f k8s/00-namespace.yaml

# Secret generado desde .env, solo con las claves necesarias, en UTF-8 y con saltos de linea LF
$tmp = Join-Path $env:TEMP ("pedidos-secret-" + [guid]::NewGuid().ToString("N") + ".env")
try {
    $lineas = @()
    foreach ($k in $CLAVES_SECRETAS) { if ($cfg[$k]) { $lineas += "$k=$($cfg[$k])" } }
    [IO.File]::WriteAllText($tmp, (($lineas -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    kubectl -n $NS delete secret pedidos-secret --ignore-not-found | Out-Null
    Run kubectl -n $NS create secret generic pedidos-secret --from-env-file=$tmp
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Run kubectl apply -f k8s/mysql.yaml
Run kubectl -n $NS rollout status statefulset/pedidos-mysql --timeout=300s

$webExistia = kubectl -n $NS get deployment pedidos-web --ignore-not-found -o name
Run kubectl apply -f k8s/pedidos.yaml
# Misma etiqueta de imagen: si ya existia, se reinicia para tomar el Secret / la imagen nuevos
if ($webExistia) { Run kubectl -n $NS rollout restart deployment/pedidos-web }
Run kubectl -n $NS rollout status deployment/pedidos-web --timeout=180s

Run kubectl -n $NS get 'statefulsets,deployments,pods,services'
Write-Host ""

# La app crea las tablas y carga el dump en cuanto puede hablar con MySQL: esperar y comprobar
Write-Host "Comprobando que el dump quedo cargado..."
$n = $null
for ($i = 0; $i -lt 15; $i++) {
    $n = Contar-Pedidos
    if ($null -ne $n -and $n -ge $PEDIDOS_EN_DUMP) { break }
    Start-Sleep -Seconds 2
}
if ($null -ne $n -and $n -ge $PEDIDOS_EN_DUMP) {
    Write-Host "Dump cargado: $n pedidos en MySQL." -ForegroundColor Green
} else {
    Write-Host "No se pudo confirmar el dump (pedidos encontrados: $n). Revisa: .\k8s\deploy.ps1 -Accion Logs" -ForegroundColor Yellow
}

Mostrar-Salud (Probar-Health)
Write-Host "Listo:  $URL" -ForegroundColor Green
