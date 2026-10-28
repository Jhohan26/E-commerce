<#
.SYNOPSIS
  Detiene los nueve modulos del E-commerce en Kubernetes sin borrar datos.

.EXAMPLE
  .\stop-all.ps1
  .\stop-all.ps1 -Modulos Productos,Clientes
  .\stop-all.ps1 -Accion Iniciar        # revierte el apagado sin reconstruir imagenes
  .\stop-all.ps1 -Simular

.NOTES
  Usa el contexto docker-desktop y escala SOLO recursos identificados del proyecto.
  No elimina Deployments, StatefulSets, Services, Secrets, namespaces ni PVC.
#>
[CmdletBinding()]
param(
    [ValidateSet('Detener', 'Iniciar')]
    [string]$Accion = 'Detener',
    [ValidateSet('Todos', 'Clientes', 'Productos', 'Inventario', 'Pedidos', 'Pagos', 'Facturacion', 'Notificaciones', 'Carrito', 'Reportes')]
    [string[]]$Modulos = @('Todos'),
    [switch]$Simular
)

$ErrorActionPreference = 'Stop'
$contexto = 'docker-desktop'

if ('Todos' -in $Modulos -and $Modulos.Count -ne 1) {
    throw 'Usa -Modulos Todos o una lista de modulos concretos.'
}

# Primero se detienen consumidores/servicios; despues sus bases de datos.
# Los nombres corresponden a los manifiestos k8s de este proyecto.
$catalogo = @(
    @{ Nombre = 'Reportes';       Namespace = 'reportes';       Deployments = @('reportes');                                 StatefulSets = @() },
    @{ Nombre = 'Carrito';        Namespace = 'carrito';        Deployments = @('carrito');                                  StatefulSets = @() },
    @{ Nombre = 'Facturacion';    Namespace = 'facturacion';    Deployments = @('facturacion-api');                          StatefulSets = @('facturacion-mysql') },
    @{ Nombre = 'Pagos';          Namespace = 'pagos';          Deployments = @('pagos-web', 'pagos-consumer');              StatefulSets = @('pagos-mysql') },
    @{ Nombre = 'Pedidos';        Namespace = 'pedidos';        Deployments = @('pedidos-web');                              StatefulSets = @('pedidos-mysql') },
    @{ Nombre = 'Notificaciones'; Namespace = 'notificaciones'; Deployments = @('notificaciones');                          StatefulSets = @() },
    @{ Nombre = 'Inventario';     Namespace = 'inventario';     Deployments = @('inventario-api', 'inventario-worker');       StatefulSets = @('inventario-mysql') },
    @{ Nombre = 'Productos';      Namespace = 'productos';      Deployments = @('backend', 'frontend', 'worker');             StatefulSets = @('mysql') },
    @{ Nombre = 'Clientes';       Namespace = 'clientes';       Deployments = @('web', 'worker');                          StatefulSets = @('mysql') }
)

$seleccion = @($catalogo | Where-Object { 'Todos' -in $Modulos -or $_.Nombre -in $Modulos })
if ($Accion -eq 'Iniciar') { [array]::Reverse($seleccion) }
Write-Host "`n${Accion} E-commerce: $($seleccion.Nombre -join ', ')" -ForegroundColor Cyan

if ($Simular) {
    Write-Host 'SIMULACION: no se consultara ni modificara Kubernetes.' -ForegroundColor Yellow
} else {
    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
        throw 'No se encontro kubectl. Instala kubectl y activa Kubernetes en Docker Desktop.'
    }
    & kubectl --context $contexto cluster-info | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "No se puede conectar con Kubernetes (contexto $contexto)."
    }
}

$procesados = 0
$ausentes = 0

foreach ($modulo in $seleccion) {
    Write-Host "`n=== $($modulo.Nombre) ($($modulo.Namespace)) ===" -ForegroundColor Cyan

    if (-not $Simular) {
        $nsActual = & kubectl --context $contexto get namespace $modulo.Namespace --ignore-not-found -o name
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo consultar el namespace $($modulo.Namespace)."
        }
        if ([string]::IsNullOrWhiteSpace(($nsActual | Out-String).Trim())) {
            Write-Host '[OMITIDO] Namespace aun no creado.' -ForegroundColor DarkYellow
            continue
        }
    }

    $recursos = @()
    if ($Accion -eq 'Iniciar') {
        foreach ($nombre in $modulo.StatefulSets) { $recursos += "statefulset/$nombre" }
        foreach ($nombre in $modulo.Deployments) { $recursos += "deployment/$nombre" }
    } else {
        foreach ($nombre in $modulo.Deployments) { $recursos += "deployment/$nombre" }
        foreach ($nombre in $modulo.StatefulSets) { $recursos += "statefulset/$nombre" }
    }

    foreach ($recurso in $recursos) {
        # Los manifiestos declaran 2 replicas para estas dos APIs web;
        # todos los otros workloads del proyecto declaran 1 replica.
        $replicas = 0
        if ($Accion -eq 'Iniciar') {
            $replicas = 1
            if (($modulo.Nombre -eq 'Clientes' -and $recurso -eq 'deployment/web') -or
                ($modulo.Nombre -eq 'Productos' -and $recurso -eq 'deployment/backend')) {
                $replicas = 2
            }
        }
        if ($Simular) {
            Write-Host "[SIMULAR] kubectl --context $contexto -n $($modulo.Namespace) scale $recurso --replicas=$replicas"
            continue
        }

        $existe = & kubectl --context $contexto -n $modulo.Namespace get $recurso --ignore-not-found -o name
        if ($LASTEXITCODE -ne 0) { throw "No se pudo consultar $recurso en $($modulo.Namespace)." }
        if ([string]::IsNullOrWhiteSpace(($existe | Out-String).Trim())) {
            Write-Host "[OMITIDO] $recurso no existe." -ForegroundColor DarkYellow
            $ausentes++
            continue
        }

        Write-Host "[$($Accion.ToUpperInvariant())] $recurso ($replicas replicas)" -ForegroundColor Yellow
        & kubectl --context $contexto -n $modulo.Namespace scale $recurso "--replicas=$replicas"
        if ($LASTEXITCODE -ne 0) { throw "Fallo al cambiar las replicas de $recurso en $($modulo.Namespace)." }
        $procesados++
    }
}

if ($Simular) {
    Write-Host "`nSimulacion finalizada. Para ejecutar realmente, omite -Simular." -ForegroundColor Green
} else {
    Write-Host "`n${Accion}: procesados $procesados recurso(s); $ausentes no existian." -ForegroundColor Green
    Write-Host 'Kubernetes aplicara los cambios de replicas en segundo plano. Los PVC se conservan.'
    if ($Accion -eq 'Detener') {
        Write-Host 'Para reanudar sin reconstruir ni desplegar: .\stop-all.ps1 -Accion Iniciar'
    }
}
