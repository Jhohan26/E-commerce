<#
.SYNOPSIS
  Despliega y administra el modulo de Pagos (Grupo B) en Kubernetes (Docker Desktop).

.EXAMPLE
  .\k8s\deploy.ps1                         # construye las imagenes y despliega (o actualiza)
  .\k8s\deploy.ps1 -SinBuild               # despliega sin reconstruir las imagenes
  .\k8s\deploy.ps1 -Accion Estado          # pods, servicios, salud y esquema
  .\k8s\deploy.ps1 -Accion Logs            # logs del consumidor en vivo (Ctrl+C para salir)
  .\k8s\deploy.ps1 -Accion Logs -Servicio web
  .\k8s\deploy.ps1 -Accion Token           # token JWT de laboratorio (rol operador, 1 hora)
  .\k8s\deploy.ps1 -Accion Token -Rol administrador
  .\k8s\deploy.ps1 -Accion Detener         # apaga web, consumidor y MySQL (conserva los datos)
  .\k8s\deploy.ps1 -Accion Iniciar         # los vuelve a encender
  .\k8s\deploy.ps1 -Accion Borrar          # elimina el namespace pagos (incluida la base de datos)
#>
param(
    [ValidateSet("Desplegar", "Estado", "Logs", "Token", "Detener", "Iniciar", "Borrar")]
    [string]$Accion = "Desplegar",
    [ValidateSet("consumer", "web")]
    [string]$Servicio = "consumer",
    [ValidateSet("operador", "administrador", "cliente")]
    [string]$Rol = "operador",
    [switch]$SinBuild
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raiz del proyecto

$NS        = "pagos"
$IMG_APP   = "pagos:cluster-v1"                   # debe coincidir con k8s/pagos.yaml
$IMG_MYSQL = "pagos-mysql:1.0"                    # debe coincidir con k8s/mysql.yaml
$PUERTO    = 8086                                 # puerto de k8s/pagos.yaml (Service pagos-web-local)
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

function Probar-Ready {
    for ($i = 0; $i -lt 20; $i++) {
        try { return (Invoke-RestMethod -Uri "$URL/ready.php" -TimeoutSec 5) }
        catch { Start-Sleep -Seconds 2 }
    }
    return $null
}

function Mostrar-Salud($r) {
    if ($r -and $r.status -eq "ready") { Write-Host "Web OK y conectada a MySQL ($URL/login.php)" -ForegroundColor Green }
    else { Write-Host "La web no responde como lista en $URL (revisa: .\k8s\deploy.ps1 -Accion Logs -Servicio web)" -ForegroundColor Yellow }
}

# El esquema creado por la imagen: console.php check-db verifica las columnas de la tabla pagos
function Probar-Esquema {
    return (Prueba kubectl -n $NS exec deployment/pagos-web -- php bin/console.php check-db)
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
        Mostrar-Salud (Probar-Ready)
        if (Probar-Esquema) { Write-Host "Esquema OK: tabla pagos con las columnas esperadas." -ForegroundColor Green }
        else { Write-Host "No se pudo verificar el esquema (check-db)." -ForegroundColor Yellow }
        return
    }
    "Logs"    { Run kubectl -n $NS logs "deployment/pagos-$Servicio" -f --tail=100; return }
    "Token"   {
        Write-Host "Pega el JWT en 'Acceso temporal de desarrollo' de la web. Dura 1 hora; no lo guardes ni lo compartas." -ForegroundColor Yellow
        Run kubectl -n $NS exec deployment/pagos-web -- php bin/lab-token.php $Rol
        return
    }
    "Detener" {
        Run kubectl -n $NS scale deployment/pagos-web deployment/pagos-consumer --replicas=0
        Run kubectl -n $NS scale statefulset/pagos-mysql --replicas=0
        Write-Host "Pagos detenido (los datos se conservan). Para encenderlo: .\k8s\deploy.ps1 -Accion Iniciar" -ForegroundColor Green
        return
    }
    "Iniciar" {
        Run kubectl -n $NS scale statefulset/pagos-mysql --replicas=1
        Run kubectl -n $NS rollout status statefulset/pagos-mysql --timeout=300s
        Run kubectl -n $NS scale deployment/pagos-web deployment/pagos-consumer --replicas=1
        Run kubectl -n $NS rollout status deployment/pagos-web --timeout=180s
        Run kubectl -n $NS rollout status deployment/pagos-consumer --timeout=180s
        Write-Host "Pagos en marcha: $URL/login.php" -ForegroundColor Green
        return
    }
    "Borrar" {
        Write-Host "Se borrara el namespace $NS COMPLETO, incluida la base de datos de Pagos." -ForegroundColor Yellow
        if ((Read-Host "Escribe SI para continuar") -ne "SI") { Write-Host "Cancelado."; return }
        Run kubectl delete namespace $NS
        return
    }
}

# ---------- Desplegar ----------
if (-not (Test-Path .env)) { throw "No existe el archivo .env en la raiz del proyecto (copia .env.example a .env y completalo)." }
$cfg = Leer-Env ".env"

# Dentro del cluster Pagos usa SU propio MySQL: los DB_* del .env (XAMPP) no se usan
if (-not $cfg["RABBITMQ_URL"] -or $cfg["RABBITMQ_URL"] -like "*usuario:clave*" -or $cfg["RABBITMQ_URL"] -like "*localhost*") {
    throw "RABBITMQ_URL falta, es el ejemplo o apunta a localhost en .env. Dentro del cluster debe ser la URL de CloudAMQP (amqps://...)."
}
if (-not $cfg["JWT_SECRET"] -or $cfg["JWT_SECRET"].Length -lt 32) {
    throw "JWT_SECRET falta o tiene menos de 32 caracteres en .env."
}
if (-not $cfg["CLIENT_AUTH_USER"] -or -not $cfg["CLIENT_AUTH_PASSWORD"]) {
    Write-Warning "CLIENT_AUTH_USER / CLIENT_AUTH_PASSWORD no estan en .env: Pagos no podra consultar nombres de clientes (auth.login)."
}

# Dos consumidores en pagos_pedidos_queue se reparten los pedidos: no permitir el de la instalacion anterior
$viejo = Salida kubectl -n ecommerce get deployment pagos-consumer --ignore-not-found -o name
if ($viejo) {
    throw ("Hay un consumidor de Pagos de la instalacion anterior en el namespace ecommerce. Dos consumidores se reparten los pedidos. Eliminalo antes:`n" +
           "  kubectl -n ecommerce delete deployment pagos-web pagos-consumer`n" +
           "  kubectl -n ecommerce delete service pagos-web pagos-web-local")
}

# Si el LoadBalancer aun no existe y el puerto esta ocupado, avisar antes de empezar
$existe = Salida kubectl -n $NS get service pagos-web-local --ignore-not-found -o name
if (-not $existe) {
    $ocupado = Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue
    if ($ocupado) {
        throw "El puerto $PUERTO esta ocupado (otro Pagos, port-forward o php -S). Liberalo, o cambia 'port' en k8s/pagos.yaml y `$PUERTO en este script."
    }
}

# Claves de MySQL: se reutilizan las del Secret existente (el volumen ya fue inicializado con ellas); si no hay, se generan
$dbPass   = Leer-Secret "pagos-secret" "DB_PASSWORD"
$rootPass = Leer-Secret "pagos-secret" "MYSQL_ROOT_PASSWORD"
if (-not $dbPass -or -not $rootPass) {
    if (Prueba kubectl -n $NS get pvc datos-pagos-mysql-0) {
        throw "Existe el volumen de MySQL pero no el Secret con sus claves: no se pueden recuperar. Ejecuta -Accion Borrar y vuelve a desplegar."
    }
    $dbPass   = Nueva-Clave
    $rootPass = Nueva-Clave
    Write-Host "Claves de MySQL generadas (se guardan solo en el Secret pagos-secret)." -ForegroundColor Green
}

if (-not $SinBuild) {
    if (-not (Prueba docker info)) { throw "Docker Desktop no esta corriendo." }
    Run docker build -t $IMG_APP .
    Run docker build -f Dockerfile.mysql -t $IMG_MYSQL .
    # La base de datos (esquema) viaja DENTRO de la imagen de MySQL
    if (-not (Prueba docker run --rm --entrypoint test $IMG_MYSQL -f /docker-entrypoint-initdb.d/01-schema.sql)) {
        throw "La imagen $IMG_MYSQL no contiene 01-schema.sql (revisa Dockerfile.mysql y Dockerfile.mysql.dockerignore)."
    }
    Write-Host "OK: el esquema de la base de datos esta dentro de la imagen $IMG_MYSQL" -ForegroundColor Green
}

Run kubectl apply -f k8s/00-namespace.yaml

# Secret generado desde .env (RabbitMQ, JWT, cuenta de servicio) + claves de MySQL, en UTF-8 sin BOM y LF
$tmp = Join-Path $env:TEMP ("pagos-secret-" + [guid]::NewGuid().ToString("N") + ".env")
try {
    $lineas = @(
        "DB_USER=pagos",
        "DB_PASSWORD=$dbPass",
        "MYSQL_ROOT_PASSWORD=$rootPass",
        "RABBITMQ_URL=$($cfg['RABBITMQ_URL'])",
        "JWT_SECRET=$($cfg['JWT_SECRET'])",
        "JWT_ISSUER=$($cfg['JWT_ISSUER'])",
        "CLIENT_AUTH_USER=$($cfg['CLIENT_AUTH_USER'])",
        "CLIENT_AUTH_PASSWORD=$($cfg['CLIENT_AUTH_PASSWORD'])"
    )
    [IO.File]::WriteAllText($tmp, (($lineas -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    kubectl -n $NS delete secret pagos-secret --ignore-not-found | Out-Null
    Run kubectl -n $NS create secret generic pagos-secret --from-env-file=$tmp
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Run kubectl apply -f k8s/mysql.yaml
# La sonda de MySQL exige que exista la tabla pagos: cuando termina, el esquema ya esta cargado
Run kubectl -n $NS rollout status statefulset/pagos-mysql --timeout=300s

$webExistia = Salida kubectl -n $NS get deployment pagos-web --ignore-not-found -o name
Run kubectl apply -f k8s/pagos.yaml
# Misma etiqueta de imagen: si ya existian, se reinician para tomar el Secret / la imagen nuevos
if ($webExistia) {
    Run kubectl -n $NS rollout restart deployment/pagos-web deployment/pagos-consumer
}
Run kubectl -n $NS rollout status deployment/pagos-web --timeout=180s
Run kubectl -n $NS rollout status deployment/pagos-consumer --timeout=180s

Run kubectl -n $NS get 'statefulsets,deployments,pods,services'
Write-Host ""

if (Probar-Esquema) { Write-Host "Esquema OK: tabla pagos con las columnas esperadas (InnoDB)." -ForegroundColor Green }
else { Write-Host "No se pudo verificar el esquema. Revisa: kubectl -n $NS logs statefulset/pagos-mysql" -ForegroundColor Yellow }

Mostrar-Salud (Probar-Ready)
Write-Host "Listo:  $URL/login.php   (token de laboratorio: .\k8s\deploy.ps1 -Accion Token)" -ForegroundColor Green
