<#
.SYNOPSIS
  Despliega y administra el modulo de Facturacion (Grupo K) en Kubernetes (Docker Desktop).

.EXAMPLE
  .\k8s\deploy.ps1                       # construye las imagenes y despliega (o actualiza)
  .\k8s\deploy.ps1 -SinBuild             # despliega sin reconstruir las imagenes
  .\k8s\deploy.ps1 -Accion Estado        # pods, servicios, salud y esquema
  .\k8s\deploy.ps1 -Accion Logs          # logs en vivo (Ctrl+C para salir)
  .\k8s\deploy.ps1 -Accion Probar        # publica un PagoAprobado de prueba (pedido 1001) en cola_facturacion
  .\k8s\deploy.ps1 -Accion Probar -Pedido 1002
  .\k8s\deploy.ps1 -Accion Detener       # apaga API y MySQL (conserva los datos)
  .\k8s\deploy.ps1 -Accion Iniciar       # los vuelve a encender
  .\k8s\deploy.ps1 -Accion Borrar        # elimina el namespace facturacion (incluida la base de datos)
#>
param(
    [ValidateSet("Desplegar", "Estado", "Logs", "Probar", "Detener", "Iniciar", "Borrar")]
    [string]$Accion = "Desplegar",
    [int]$Pedido = 1001,
    [switch]$SinBuild
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raiz del proyecto

$NS        = "facturacion"
$IMG_APP   = "facturacion-app:1.0"                # debe coincidir con k8s/facturacion.yaml
$IMG_MYSQL = "facturacion-mysql:1.0"              # debe coincidir con k8s/mysql.yaml
$PUERTO    = 8007                                 # puerto de k8s/facturacion.yaml (Service facturacion-api)
$URL       = "http://localhost:$PUERTO"

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

# Clave aleatoria alfanumerica (sin caracteres que compliquen comillas o URLs)
function Nueva-Clave {
    $alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $bytes = New-Object byte[] 28
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return (-join ($bytes | ForEach-Object { $alfabeto[$_ % $alfabeto.Length] }))
}

function Probar-Health {
    for ($i = 0; $i -lt 20; $i++) {
        try { return (Invoke-RestMethod -Uri "$URL/health" -TimeoutSec 5) }
        catch { Start-Sleep -Seconds 2 }
    }
    return $null
}

function Mostrar-Salud($r) {
    if (-not $r) { Write-Host "La API no responde en $URL (revisa: .\k8s\deploy.ps1 -Accion Logs)" -ForegroundColor Yellow; return }
    $color = "Green"
    if ($r.base_de_datos -ne "ok" -or $r.rabbitmq -ne "ok") { $color = "Yellow" }
    Write-Host ("API: {0}  |  MySQL: {1}  |  RabbitMQ: {2}" -f $r.api, $r.base_de_datos, $r.rabbitmq) -ForegroundColor $color
}

# Cuenta las columnas cliente_* de la tabla Factura (el esquema correcto tiene 3: id, nombre, correo)
function Contar-ColumnasCliente {
    $sh = "MYSQL_PWD=`$MYSQL_ROOT_PASSWORD mysql -uroot -N -e 'SHOW COLUMNS FROM facturacion.Factura' | grep -c cliente_"
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $salida = & kubectl -n $NS exec facturacion-mysql-0 -- sh -c $sh 2>$null
        $n = 0
        if ([int]::TryParse(("$salida").Trim(), [ref]$n)) { return $n }
        return $null
    } finally { $ErrorActionPreference = $anterior }
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
        $c = Contar-ColumnasCliente
        if ($c -ge 3) { Write-Host "Esquema OK: la tabla Factura tiene cliente_id, cliente_nombre y cliente_correo." -ForegroundColor Green }
        else { Write-Host "No se pudo confirmar el esquema de la tabla Factura." -ForegroundColor Yellow }
        return
    }
    "Logs"    { Run kubectl -n $NS logs deployment/facturacion-api -f --tail=100; return }
    "Probar"  {
        Write-Host "Publicando un PagoAprobado de prueba (pedido $Pedido) directamente en cola_facturacion..." -ForegroundColor Yellow
        Run kubectl -n $NS exec deployment/facturacion-api -- python scripts/publicar_prueba.py $Pedido 15:2
        Write-Host "Mira el resultado en: $URL/api/facturas   o con -Accion Logs" -ForegroundColor Green
        return
    }
    "Detener" {
        Run kubectl -n $NS scale deployment/facturacion-api --replicas=0
        Run kubectl -n $NS scale statefulset/facturacion-mysql --replicas=0
        Write-Host "Facturacion detenido (los datos se conservan). Para encenderlo: .\k8s\deploy.ps1 -Accion Iniciar" -ForegroundColor Green
        return
    }
    "Iniciar" {
        Run kubectl -n $NS scale statefulset/facturacion-mysql --replicas=1
        Run kubectl -n $NS rollout status statefulset/facturacion-mysql --timeout=300s
        Run kubectl -n $NS scale deployment/facturacion-api --replicas=1
        Run kubectl -n $NS rollout status deployment/facturacion-api --timeout=180s
        Write-Host "Facturacion en marcha: $URL" -ForegroundColor Green
        return
    }
    "Borrar" {
        Write-Host "Se borrara el namespace $NS COMPLETO, incluida la base de datos de Facturacion." -ForegroundColor Yellow
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

# Dentro del cluster Facturacion usa SU propio MySQL: los DB_* y CLIENTES_URL del .env no se usan
if (-not $cfg["RABBITMQ_URL"] -or $cfg["RABBITMQ_URL"] -like "*usuario:clave*" -or $cfg["RABBITMQ_URL"] -like "*localhost*") {
    throw "RABBITMQ_URL falta, es el ejemplo o apunta a localhost en .env. Dentro del cluster debe ser la URL de CloudAMQP (amqps://...)."
}

# Si el LoadBalancer aun no existe y el puerto esta ocupado, avisar antes de empezar
$existe = Salida kubectl -n $NS get service facturacion-api --ignore-not-found -o name
if (-not $existe) {
    $ocupado = Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue
    if ($ocupado) {
        throw "El puerto $PUERTO esta ocupado (uvicorn o 'docker compose --profile app' de Facturacion?). Detenlo, o cambia 'port' en k8s/facturacion.yaml y `$PUERTO en este script."
    }
}

# Claves de MySQL: se reutilizan las del Secret existente (el volumen ya fue inicializado con ellas); si no hay, se generan
$dbPass   = Leer-Secret "facturacion-secret" "DB_PASSWORD"
$rootPass = Leer-Secret "facturacion-secret" "MYSQL_ROOT_PASSWORD"
if (-not $dbPass -or -not $rootPass) {
    if (Prueba kubectl -n $NS get pvc datos-facturacion-mysql-0) {
        throw "Existe el volumen de MySQL pero no el Secret con sus claves: no se pueden recuperar. Ejecuta -Accion Borrar y vuelve a desplegar."
    }
    $dbPass   = Nueva-Clave
    $rootPass = Nueva-Clave
    Write-Host "Claves de MySQL generadas (se guardan solo en el Secret facturacion-secret)." -ForegroundColor Green
}

if (-not $SinBuild) {
    if (-not (Prueba docker info)) { throw "Docker Desktop no esta corriendo." }
    Run docker build -t $IMG_APP .
    Run docker build -f Dockerfile.mysql -t $IMG_MYSQL .
    # La base de datos (esquema) viaja DENTRO de la imagen de MySQL, y debe traer las columnas que el codigo escribe
    if (-not (Prueba docker run --rm --entrypoint test $IMG_MYSQL -f /docker-entrypoint-initdb.d/01-schema.sql)) {
        throw "La imagen $IMG_MYSQL no contiene 01-schema.sql (revisa Dockerfile.mysql y Dockerfile.mysql.dockerignore)."
    }
    if (-not (Prueba docker run --rm --entrypoint grep $IMG_MYSQL -q cliente_nombre /docker-entrypoint-initdb.d/01-schema.sql)) {
        throw "El sql/schema.sql dentro de la imagen no tiene cliente_nombre/cliente_correo: usa el sql/schema.sql corregido que viene en el paquete."
    }
    Write-Host "OK: el esquema de la base de datos esta dentro de la imagen $IMG_MYSQL" -ForegroundColor Green
}

Run kubectl apply -f k8s/00-namespace.yaml

# Secret: RabbitMQ desde .env + claves de MySQL, en UTF-8 sin BOM y con saltos de linea LF
$tmp = Join-Path $env:TEMP ("facturacion-secret-" + [guid]::NewGuid().ToString("N") + ".env")
try {
    $lineas = @(
        "DB_USER=facturacion",
        "DB_PASSWORD=$dbPass",
        "MYSQL_ROOT_PASSWORD=$rootPass",
        "RABBITMQ_URL=$($cfg['RABBITMQ_URL'])"
    )
    [IO.File]::WriteAllText($tmp, (($lineas -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    kubectl -n $NS delete secret facturacion-secret --ignore-not-found | Out-Null
    Run kubectl -n $NS create secret generic facturacion-secret --from-env-file=$tmp
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Run kubectl apply -f k8s/mysql.yaml
# La sonda de MySQL exige que exista la tabla Factura: cuando termina, el esquema ya esta cargado
Run kubectl -n $NS rollout status statefulset/facturacion-mysql --timeout=300s

$apiExistia = Salida kubectl -n $NS get deployment facturacion-api --ignore-not-found -o name
Run kubectl apply -f k8s/facturacion.yaml
# Misma etiqueta de imagen: si ya existia, se reinicia para tomar el Secret / la imagen nuevos
if ($apiExistia) { Run kubectl -n $NS rollout restart deployment/facturacion-api }
Run kubectl -n $NS rollout status deployment/facturacion-api --timeout=180s

Run kubectl -n $NS get 'statefulsets,deployments,pods,services'
Write-Host ""

$c = Contar-ColumnasCliente
if ($c -ge 3) { Write-Host "Esquema OK: la tabla Factura tiene cliente_id, cliente_nombre y cliente_correo." -ForegroundColor Green }
else { Write-Host "No se pudo confirmar el esquema. Revisa: kubectl -n $NS logs statefulset/facturacion-mysql" -ForegroundColor Yellow }

Mostrar-Salud (Probar-Health)
Write-Host "Listo:  $URL   (docs: $URL/docs)   Prueba: .\k8s\deploy.ps1 -Accion Probar" -ForegroundColor Green
