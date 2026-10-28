<#
Instala exclusivamente Pagos en Docker Desktop Kubernetes del computador comun.
No ejecuta scripts de otros grupos ni borra recursos, bases de datos o volumenes.
#>
param(
    [ValidateSet('Desplegar', 'Estado', 'Logs', 'Detener', 'Iniciar', 'Validar')]
    [string]$Accion = 'Desplegar',
    [string]$Contexto = 'docker-desktop',
    [switch]$SinBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$ns = 'ecommerce'
$image = 'pagos:cluster-v1'

function Run {
    $program = $args[0]
    $commandArgs = @($args | Select-Object -Skip 1)
    & $program @commandArgs
    if ($LASTEXITCODE -ne 0) { throw 'Fallo una operacion; revisar el mensaje anterior.' }
}
function Kube {
    & kubectl --context $Contexto @args
    if ($LASTEXITCODE -ne 0) { throw 'Fallo Kubernetes; revisar el mensaje anterior.' }
}
function Read-Config([string]$path) {
    $config = @{}
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        $line = $line.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $parts = $line.Split(@('='), 2)
        if ($parts.Count -ne 2) { throw 'Linea invalida en .env.k8s.' }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($config.ContainsKey($key)) { throw "Clave repetida: $key" }
        $config[$key] = $value
    }
    return $config
}

if ($Accion -in @('Desplegar', 'Validar')) {
    if (-not (Test-Path '.env.k8s')) { throw 'Copia .env.k8s.example como .env.k8s y completa sus valores.' }
    $cfg = Read-Config (Join-Path $root '.env.k8s')
    $required = @('DB_USER', 'DB_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'RABBITMQ_URL', 'JWT_SECRET', 'CLIENT_AUTH_USER', 'CLIENT_AUTH_PASSWORD')
    foreach ($key in $required) {
        if (-not $cfg[$key] -or $cfg[$key] -like '*CAMBIAR*') { throw "Falta completar $key en .env.k8s." }
    }
    if ($cfg.DB_USER -eq 'root' -or $cfg.DB_USER -notmatch '^[a-zA-Z0-9_]+$') { throw 'DB_USER debe ser una cuenta propia, por ejemplo pagos; no root.' }
    if ($cfg.JWT_SECRET.Length -lt 32) { throw 'JWT_SECRET debe tener al menos 32 caracteres.' }
    $brokerUri = $null
    if (-not [Uri]::TryCreate($cfg.RABBITMQ_URL, [UriKind]::Absolute, [ref]$brokerUri) -or $brokerUri.Scheme -notin @('amqp', 'amqps') -or -not $brokerUri.UserInfo -or $brokerUri.Host -eq 'host.rmq.cloudamqp.com') {
        throw 'RABBITMQ_URL debe ser la URL real acordada con los grupos.'
    }
    if (-not $cfg.ContainsKey('JWT_ISSUER')) { $cfg.JWT_ISSUER = '' }
    Write-Host 'Configuracion local valida; no se muestran credenciales.'
    if ($Accion -eq 'Validar') { return }
}

Kube cluster-info
switch ($Accion) {
    'Estado' {
        Kube -n $ns get deployment/pagos-web deployment/pagos-consumer statefulset/pagos-mysql
        Kube -n $ns get pods -l 'app in (pagos-web,pagos-consumer,pagos-mysql)'
        Kube -n $ns get service/pagos-web service/pagos-web-local service/pagos-mysql
        return
    }
    'Logs' { Kube -n $ns logs deployment/pagos-consumer --tail=80; return }
    'Detener' {
        Kube -n $ns scale deployment/pagos-consumer deployment/pagos-web --replicas=0
        Write-Host 'Web y consumidor detenidos. MySQL y sus datos se conservan.'
        return
    }
    'Iniciar' {
        Kube -n $ns rollout status statefulset/pagos-mysql --timeout=300s
        Kube -n $ns scale deployment/pagos-web deployment/pagos-consumer --replicas=1
        Kube -n $ns rollout status deployment/pagos-web --timeout=180s
        Kube -n $ns rollout status deployment/pagos-consumer --timeout=180s
        return
    }
}

# Crear solo el namespace necesario antes de consultar recursos opcionales.
Kube apply -f k8s/comun/00-namespace.yaml

# No migrar silenciosamente una instalacion que usa XAMPP u otra base externa.
$existingConfig = Kube -n $ns get configmap pagos-config --ignore-not-found -o json
if ($existingConfig) {
    $existingHost = ($existingConfig | ConvertFrom-Json).data.DB_HOST
    if ($existingHost -and $existingHost -ne 'pagos-mysql') {
        throw 'Ya hay Pagos configurado con otra base de datos. Coordina la migracion y el respaldo antes de usar esta instalacion.'
    }
}

# Con un volumen inicializado, editar el Secret no cambia las cuentas de MySQL.
$existingVolume = Kube -n $ns get pvc datos-pagos-mysql-0 --ignore-not-found -o name
if ($existingVolume) {
    $existingSecret = (Kube -n $ns get secret pagos-secret -o json) | ConvertFrom-Json
    foreach ($key in @('DB_USER', 'DB_PASSWORD', 'MYSQL_ROOT_PASSWORD')) {
        $previous = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($existingSecret.data.$key))
        if ($previous -cne $cfg[$key]) { throw "No cambies $key con un volumen inicializado. Se requiere una rotacion de credenciales de MySQL." }
    }
}

if (-not $SinBuild) {
    Run docker info --format '{{.ServerVersion}}'
    Run docker build -t $image .
}
# Secret aplicado sin imprimir su contenido y sin archivos temporales con secretos.
$secretValues = @{}
foreach ($key in ($required + @('JWT_ISSUER'))) { $secretValues[$key] = $cfg[$key] }
$secret = @{
    apiVersion = 'v1'; kind = 'Secret'; type = 'Opaque'
    metadata = @{ name = 'pagos-secret'; namespace = $ns }
    stringData = $secretValues
} | ConvertTo-Json -Depth 6 -Compress
$secret | & kubectl --context $Contexto apply -f -
if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar pagos-secret.' }
$schema = Kube -n $ns create configmap pagos-schema --from-file=01-schema.sql=database/schema.sql --dry-run=client -o json
$schema | & kubectl --context $Contexto apply -f -
if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar el esquema inicial.' }

Kube apply -f k8s/comun/mysql.yaml
Kube -n $ns rollout status statefulset/pagos-mysql --timeout=300s
Kube apply -f k8s/comun/pagos.yaml
# Releer Secret e imagen incluso cuando se conserva la etiqueta de laboratorio.
Kube -n $ns rollout restart deployment/pagos-web deployment/pagos-consumer
Kube -n $ns rollout status deployment/pagos-web --timeout=180s
Kube -n $ns rollout status deployment/pagos-consumer --timeout=180s
Kube -n $ns exec deployment/pagos-web -- php bin/console.php check-db

$health = Invoke-RestMethod 'http://localhost:8086/health.php' -TimeoutSec 10
$ready = Invoke-RestMethod 'http://localhost:8086/ready.php' -TimeoutSec 10
if ($health.status -ne 'ok' -or $ready.status -ne 'ready') { throw 'La comprobacion HTTP final no fue correcta.' }
Write-Host 'Pagos listo: http://localhost:8086/login.php' -ForegroundColor Green
Write-Host 'Acceso de laboratorio: kubectl -n ecommerce exec deployment/pagos-web -- php bin/lab-token.php operador'
Write-Host 'Coordinar un solo consumidor de Pagos conectado al broker compartido.'
