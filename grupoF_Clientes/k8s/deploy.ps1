# Despliega el proyecto en Kubernetes (Docker Desktop). Ejecutar desde PowerShell:
#   .\k8s\deploy.ps1
#   .\k8s\deploy.ps1 -SinBuild  # reutiliza clientes-app:1.0
param([switch]$SinBuild)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raíz del proyecto

function Run {
    & $args[0] $args[1..($args.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "Fallo: $($args -join ' ')" }
}

if (-not (Test-Path .env)) { throw "No existe el archivo .env en la raíz del proyecto." }

Run kubectl config use-context docker-desktop
if (-not $SinBuild) { Run docker build -t clientes-app:1.0 . }

Run kubectl apply -f k8s/00-namespace.yaml

# Secret con tu .env y ConfigMap con dump.sql (se recrean en cada despliegue)
kubectl -n clientes delete secret clientes-env --ignore-not-found | Out-Null
Run kubectl -n clientes create secret generic clientes-env --from-env-file=.env
kubectl -n clientes delete configmap clientes-dump --ignore-not-found | Out-Null
Run kubectl -n clientes create configmap clientes-dump --from-file=01-dump.sql=dump.sql

Run kubectl apply -f k8s/mysql.yaml
Run kubectl -n clientes rollout status statefulset/mysql --timeout=300s

Run kubectl apply -f k8s/web.yaml -f k8s/worker.yaml
# Garantiza que Pods existentes recarguen la imagen local y los Secrets actualizados.
Run kubectl -n clientes rollout restart deployment/web deployment/worker
Run kubectl -n clientes rollout status deployment/web --timeout=180s
Run kubectl -n clientes rollout status deployment/worker --timeout=180s

Run kubectl -n clientes get 'pods,svc'
Write-Host "`nListo: http://localhost:8081" -ForegroundColor Green
