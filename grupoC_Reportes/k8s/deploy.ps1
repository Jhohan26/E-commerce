[CmdletBinding()]
param(
    [ValidateSet('Validar', 'Instalar', 'Estado', 'Abrir')]
    [string]$Accion = 'Validar',
    [string]$Contexto = 'docker-desktop',
    [switch]$SinBuild
)
$ErrorActionPreference = 'Stop'
$grupo = Split-Path $PSScriptRoot -Parent

function Invoke-Kube {
    & kubectl --context $Contexto @args
    if ($LASTEXITCODE -ne 0) { throw 'Fallo kubectl. Revisar el mensaje anterior.' }
}

if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    throw 'Falta kubectl. Instalar/habilitar Kubernetes en Docker Desktop.'
}
if ($Accion -eq 'Estado') {
    Invoke-Kube -n reportes get deployments,pods,services,pvc
    exit
}
if ($Accion -eq 'Abrir') {
    Write-Host 'Dashboard: http://127.0.0.1:8001 (mantener esta terminal abierta).'
    Invoke-Kube -n reportes port-forward --address 127.0.0.1 service/reportes 8001:8001
    exit
}

$envPath = Join-Path $grupo '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Falta grupoC_Reportes/.env.' }
# Revisar nombres sin imprimir valores privados.
$contenido = Get-Content -LiteralPath $envPath
$requeridas = @('AMQP_URL', 'CLIENTES_RPC_USUARIO', 'CLIENTES_RPC_PASSWORD',
    'PRODUCTOS_RPC_USUARIO', 'PRODUCTOS_RPC_PASSWORD',
    'INVENTARIO_RPC_USUARIO', 'INVENTARIO_RPC_PASSWORD')
foreach ($clave in $requeridas) {
    $lineas = @($contenido | Where-Object { $_ -match "^\s*$clave\s*=" })
    if ($lineas.Count -ne 1) { throw "Definir una sola vez $clave en .env." }
    $valor = ($lineas[0] -split '=', 2)[1].Trim()
    if ($valor -eq '' -or $valor -eq '""' -or $valor -eq "''") {
        throw "Completar $clave en .env."
    }
}
Invoke-Kube cluster-info
Invoke-Kube get storageclass
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Falta Docker.' }
& docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker no esta disponible.' }
Write-Host 'Requisitos basicos revisados. Debe existir una StorageClass predeterminada.'
if ($Accion -eq 'Validar') { exit }

# No se ejecutan ni modifican archivos de otros grupos.
if (-not $SinBuild) {
    & docker build -t reportes:cluster-v1 $grupo
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo construir Reportes.' }
}
Invoke-Kube apply -f (Join-Path $PSScriptRoot 'namespace.yaml')
# El Secret pasa por memoria/stdin; no se escribe un manifiesto con credenciales.
$secreto = & kubectl --context $Contexto -n reportes create secret generic reportes-secret "--from-env-file=$envPath" --dry-run=client -o json
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el Secret.' }
$secreto | & kubectl --context $Contexto apply -f -
if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar el Secret.' }
Invoke-Kube apply -f (Join-Path $PSScriptRoot 'reportes.yaml')
# Reutilizar la etiqueta local requiere reiniciar para cargar imagen/config nuevas.
Invoke-Kube -n reportes rollout restart deployment/reportes
Invoke-Kube -n reportes rollout status deployment/reportes --timeout=180s
Invoke-Kube -n reportes get pods,services,pvc
Write-Host 'Instalado. Ejecutar .\k8s\deploy.ps1 -Accion Abrir para acceder al dashboard.'
