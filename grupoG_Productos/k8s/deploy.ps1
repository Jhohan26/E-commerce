# Despliega el proyecto en Kubernetes (Docker Desktop). Ejecutar desde PowerShell:
#   .\k8s\deploy.ps1
#   .\k8s\deploy.ps1 -SinBuild  # reutiliza las tres imagenes locales
# IMPORTANTE: si corres docker compose de este proyecto, detenlo antes (puertos 3000 y 8080).
param([switch]$SinBuild)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)   # raiz del proyecto

function Run {
    & $args[0] $args[1..($args.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "Fallo: $($args -join ' ')" }
}

if (-not (Test-Path .env)) { throw "No existe el archivo .env en la raiz del proyecto." }

Run kubectl config use-context docker-desktop

if (-not $SinBuild) {
    Run docker build -t gg-backend:1.0 ./backend
    Run docker build -t gg-frontend:1.0 ./frontend
    Run docker build -f Dockerfile.worker -t gg-worker:1.0 .
}

Run kubectl apply -f k8s/00-namespace.yaml

# Secret con tu .env y ConfigMap con el script SQL (se recrean en cada despliegue)
kubectl -n productos delete secret productos-env --ignore-not-found | Out-Null
Run kubectl -n productos create secret generic productos-env --from-env-file=.env
kubectl -n productos delete configmap productos-init --ignore-not-found | Out-Null
Run kubectl -n productos create configmap productos-init --from-file=01-dump.sql=database/dump_k8s.sql

Run kubectl apply -f k8s/mysql.yaml
Run kubectl -n productos rollout status statefulset/mysql --timeout=300s

Run kubectl apply -f k8s/backend.yaml -f k8s/frontend.yaml -f k8s/worker.yaml
# Los Deployments deben recargar los tags locales cuando se reconstruye una imagen.
Run kubectl -n productos rollout restart deployment/backend deployment/frontend deployment/worker
Run kubectl -n productos rollout status deployment/backend --timeout=180s
Run kubectl -n productos rollout status deployment/frontend --timeout=180s
Run kubectl -n productos rollout status deployment/worker --timeout=180s

Run kubectl -n productos get 'pods,svc'
Write-Host ""
Write-Host "Listo:  Frontend http://localhost:8080   API http://localhost:3000" -ForegroundColor Green
