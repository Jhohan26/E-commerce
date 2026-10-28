<#
.SYNOPSIS
  Construye/reutiliza imagenes Docker y despliega los 9 modulos en Kubernetes de Docker Desktop.

.EXAMPLE
  .\deploy-all.ps1                            # crea imagenes faltantes y despliega todo
  .\deploy-all.ps1 -Accion Construir          # prepara imagenes, sin tocar Kubernetes
  .\deploy-all.ps1 -SinBuild                  # reutiliza exclusivamente imagenes existentes
  .\deploy-all.ps1 -Reconstruir               # reconstruye todas las imagenes seleccionadas
  .\deploy-all.ps1 -Modulos Clientes,Productos,Pedidos
  .\deploy-all.ps1 -Accion Estado
  .\deploy-all.ps1 -Simular                   # muestra el plan sin ejecutar comandos
#>
[CmdletBinding()]
param(
    [ValidateSet('Desplegar', 'Construir', 'Estado')]
    [string]$Accion = 'Desplegar',
    [ValidateSet('Todos', 'Clientes', 'Productos', 'Inventario', 'Pedidos', 'Pagos', 'Facturacion', 'Notificaciones', 'Carrito', 'Reportes')]
    [string[]]$Modulos = @('Todos'),
    [switch]$SinBuild,
    [switch]$Reconstruir,
    [switch]$Simular
)

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$contexto = 'docker-desktop'

if ($SinBuild -and $Reconstruir) {
    throw 'Usa -SinBuild o -Reconstruir, pero no ambos.'
}
if ($Accion -eq 'Construir' -and $SinBuild) {
    throw 'La accion Construir no admite -SinBuild.'
}
if ('Todos' -in $Modulos -and $Modulos.Count -ne 1) {
    throw 'Usa -Modulos Todos o una lista de modulos concretos.'
}

# El orden prioriza servicios base antes de sus consumidores.
# Contexto y Dockerfile son relativos a la carpeta de cada grupo.
$catalogo = @(
    @{ Nombre = 'Clientes';       Carpeta = 'grupoF_Clientes';       Namespace = 'clientes';        Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'clientes-app:1.0';          Contexto = '.';          Dockerfile = 'Dockerfile' }) },
    @{ Nombre = 'Productos';      Carpeta = 'grupoG_Productos';      Namespace = 'productos';       Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'gg-backend:1.0';            Contexto = 'backend';    Dockerfile = 'Dockerfile' }, @{ Tag = 'gg-frontend:1.0'; Contexto = 'frontend'; Dockerfile = 'Dockerfile' }, @{ Tag = 'gg-worker:1.0'; Contexto = '.'; Dockerfile = 'Dockerfile.worker' }) },
    @{ Nombre = 'Inventario';     Carpeta = 'grupoH_Inventario';     Namespace = 'inventario';      Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'inventario-app:1.0';       Contexto = '.';          Dockerfile = 'Dockerfile' }, @{ Tag = 'inventario-mysql:1.0'; Contexto = '.'; Dockerfile = 'Dockerfile.mysql' }) },
    
    @{ Nombre = 'Pedidos';        Carpeta = 'grupoE_Pedidos';        Namespace = 'pedidos';         Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'pedidos:lab-jwt-v1';        Contexto = '.';          Dockerfile = 'Dockerfile' }) },
    @{ Nombre = 'Pagos';          Carpeta = 'grupoB_Pagos';          Namespace = 'pagos';           Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'pagos:cluster-v1';          Contexto = '.';          Dockerfile = 'Dockerfile' }, @{ Tag = 'pagos-mysql:1.0'; Contexto = '.'; Dockerfile = 'Dockerfile.mysql' }) },
    @{ Nombre = 'Facturacion';    Carpeta = 'grupoK_Facturacion';    Namespace = 'facturacion';     Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'facturacion-app:1.0';       Contexto = '.';          Dockerfile = 'Dockerfile' }, @{ Tag = 'facturacion-mysql:1.0'; Contexto = '.'; Dockerfile = 'Dockerfile.mysql' }) },
    @{ Nombre = 'Carrito';        Carpeta = 'grupoD_Carro';          Namespace = 'carrito';         Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'carrito-grupod:1.0.0';     Contexto = '.';          Dockerfile = 'Dockerfile' }) },
    @{ Nombre = 'Reportes';       Carpeta = 'grupoC_Reportes';       Namespace = 'reportes';        Deploy = 'k8s/deploy.ps1';       Imagenes = @(@{ Tag = 'reportes:cluster-v1';       Contexto = '.';          Dockerfile = 'Dockerfile' }) }
)

$seleccion = @($catalogo | Where-Object { 'Todos' -in $Modulos -or $_.Nombre -in $Modulos })
if ($seleccion.Count -eq 0) { throw 'No se seleccionaron modulos.' }

function Verificar-Comando([string]$nombre) {
    if (-not (Get-Command $nombre -ErrorAction SilentlyContinue)) {
        throw "No se encontro '$nombre'. Comprueba tu instalacion y el PATH."
    }
}

function Ejecutar([string]$programa, [string[]]$argumentos) {
    & $programa @argumentos
    if ($LASTEXITCODE -ne 0) { throw "Fallo $programa (codigo $LASTEXITCODE)." }
}

function Existe-Imagen([string]$tag) {
    # Docker image inspect no descarga imagenes ni inicia contenedores.
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker image inspect --format '{{.Id}}' $tag *> $null
        return ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $anterior }
}

Write-Host "`nE-commerce: $Accion ($($seleccion.Nombre -join ', '))" -ForegroundColor Cyan
if ($Simular) { Write-Host 'SIMULACION: no se ejecutan comandos externos.' -ForegroundColor Yellow }

if (-not $Simular) {
    if ($Accion -ne 'Estado') {
        Verificar-Comando 'docker'
        Ejecutar 'docker' @('info', '--format', '{{.OSType}}')
    }
    if ($Accion -ne 'Construir') {
        Verificar-Comando 'kubectl'
        Ejecutar 'kubectl' @('--context', $contexto, 'cluster-info')
    }
}

$construidas = 0
$reutilizadas = 0

# Preparar todas las imagenes primero evita desplegar solo media plataforma
# si una compilacion posterior falla.
foreach ($modulo in $seleccion) {
    Write-Host "`n=== $($modulo.Nombre) ===" -ForegroundColor Cyan
    $carpeta = Join-Path $raiz $modulo.Carpeta
    if (-not (Test-Path -LiteralPath $carpeta -PathType Container)) {
        throw "Falta la carpeta: $carpeta"
    }

    if ($Accion -eq 'Estado') {
        if ($Simular) {
            Write-Host "kubectl --context $contexto -n $($modulo.Namespace) get deployments,statefulsets,pods,services"
        } else {
            Ejecutar 'kubectl' @('--context', $contexto, '-n', $modulo.Namespace, 'get', 'deployments,statefulsets,pods,services')
        }
        continue
    }

    foreach ($imagen in $modulo.Imagenes) {
        $existe = $false
        if (-not $Simular) { $existe = Existe-Imagen $imagen.Tag }

        if (-not $Reconstruir -and $existe) {
            Write-Host "[CACHE] $($imagen.Tag)" -ForegroundColor Green
            $reutilizadas++
            continue
        }
        if ($SinBuild -and $Simular) {
            Write-Host "[CACHE REQUERIDA] $($imagen.Tag)" -ForegroundColor Yellow
            continue
        }
        if ($SinBuild) {
            throw "No existe $($imagen.Tag) en Docker. Ejecuta sin -SinBuild o usa -Accion Construir."
        }

        $contextoBuild = Join-Path $carpeta $imagen.Contexto
        $dockerfile = Join-Path $contextoBuild $imagen.Dockerfile
        if ($imagen.Contexto -eq '.' -and $imagen.Dockerfile -ne 'Dockerfile') {
            $dockerfile = Join-Path $carpeta $imagen.Dockerfile
        }
        if (-not (Test-Path -LiteralPath $dockerfile -PathType Leaf)) {
            throw "No se encontro el Dockerfile: $dockerfile"
        }
        Write-Host "[BUILD] $($imagen.Tag)" -ForegroundColor Yellow
        if (-not $Simular) {
            Ejecutar 'docker' @('build', '-f', $dockerfile, '-t', $imagen.Tag, $contextoBuild)
        }
        $construidas++
    }
}

if ($Accion -eq 'Desplegar') {
    foreach ($modulo in $seleccion) {
        $carpeta = Join-Path $raiz $modulo.Carpeta
        $scriptDeploy = Join-Path $carpeta $modulo.Deploy
        if (-not (Test-Path -LiteralPath $scriptDeploy -PathType Leaf)) {
            throw "No se encontro: $scriptDeploy"
        }
        Write-Host "`n[K8S] Desplegando $($modulo.Nombre) con imagenes preparadas..." -ForegroundColor Yellow
        if ($Simular) { continue }

        # Los scripts existentes hacen Set-Location: se restaura siempre la ubicacion.
        Push-Location $carpeta
        try {
            if ($modulo.Nombre -eq 'Reportes') {
                & $scriptDeploy -Accion Instalar -SinBuild -Contexto $contexto
            } else {
                & $scriptDeploy -SinBuild
            }
            if (-not $?) { throw "Fallo el despliegue de $($modulo.Nombre)." }
        } finally {
            Pop-Location
        }
    }
}

Write-Host "`nFinalizado: $construidas imagen(es) construida(s), $reutilizadas reutilizada(s)." -ForegroundColor Green
if ($Accion -eq 'Desplegar') {
    Write-Host 'Consulta el estado: .\deploy-all.ps1 -Accion Estado' -ForegroundColor Green
}
