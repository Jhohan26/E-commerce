# Pruebas aisladas del instalador: Docker, Kubernetes y HTTP son simulados.
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('pagos-deploy-test-' + [guid]::NewGuid().ToString('N'))
$originalLocation = Get-Location
$global:deployTestCommands = [Collections.Generic.List[string]]::new()
$global:deployTestHost = ''
$global:deployTestVolume = $false
$global:deployTestStoredPassword = 'test-password'
$global:deployTestApplyCount = 0
$global:deployTestBuildCount = 0

function kubectl {
    process {
        $global:LASTEXITCODE = 0
        $line = $args -join ' '
        $global:deployTestCommands.Add($line)
        if ($args -contains 'cluster-info') { return }
        if ($line -match 'get configmap pagos-config') {
            if ($global:deployTestHost) { return (@{data=@{DB_HOST=$global:deployTestHost}} | ConvertTo-Json -Compress) }
            return
        }
        if ($line -match 'get pvc datos-pagos-mysql-0') {
            if ($global:deployTestVolume) { return 'persistentvolumeclaim/datos-pagos-mysql-0' }
            return
        }
        if ($line -match 'get secret pagos-secret') {
            $data = @{}
            foreach ($entry in @{DB_USER='pagos';DB_PASSWORD=$global:deployTestStoredPassword;MYSQL_ROOT_PASSWORD='test-root-password'}.GetEnumerator()) {
                $data[$entry.Key] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($entry.Value))
            }
            return (@{data=$data} | ConvertTo-Json -Compress)
        }
        if ($line -match 'create configmap pagos-schema') { return '{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"pagos-schema"}}' }
        if ($args -contains 'apply') { $global:deployTestApplyCount++ }
    }
}
function docker { $global:LASTEXITCODE = 0; if ($args -contains 'build') { $global:deployTestBuildCount++ } }
function Invoke-RestMethod { param($Uri, $TimeoutSec); if ($Uri -like '*/ready.php') { return @{status='ready'} }; return @{status='ok'} }
function Check([bool]$ok, [string]$label) {
    if (-not $ok) { throw "FALLO: $label" }
    Write-Host "OK $label"
}
function Expect-Failure([string]$match) {
    try { & (Join-Path $testRoot 'k8s/comun/deploy.ps1') *> $null }
    catch { Check ($_.Exception.Message -like "*$match*") $match; return }
    throw "FALLO: se esperaba rechazo $match"
}
try {
    New-Item -ItemType Directory -Path (Join-Path $testRoot 'k8s/comun') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'k8s/comun/deploy.ps1') -Destination (Join-Path $testRoot 'k8s/comun/deploy.ps1')
    $envText = @'
DB_USER=pagos
DB_PASSWORD=test-password
MYSQL_ROOT_PASSWORD=test-root-password
RABBITMQ_URL=amqps://test:test@broker.invalid/test
JWT_SECRET=0123456789abcdef0123456789abcdef
CLIENT_AUTH_USER=servicio-prueba
CLIENT_AUTH_PASSWORD=clave-prueba
JWT_ISSUER=
'@
    $testEnv = Join-Path $testRoot '.env.k8s'
    [IO.File]::WriteAllText($testEnv, $envText)
    & (Join-Path $testRoot 'k8s/comun/deploy.ps1') -Accion Validar *> $null
    Check ($global:deployTestCommands.Count -eq 0) 'validacion sin contactar Kubernetes'
    & (Join-Path $testRoot 'k8s/comun/deploy.ps1') *> $null
    Check ($global:deployTestBuildCount -eq 1) 'instalacion inicial construye imagen'
    Check (($global:deployTestCommands -join "`n") -match 'rollout status statefulset/pagos-mysql') 'espera MySQL antes de instalar Pagos'
    Check (-not (($global:deployTestCommands -join "`n") -match 'delete|pagos-clientes-secret')) 'sin borrados ni Secret externo faltante'
    $global:deployTestHost = 'host.docker.internal'
    $before = $global:deployTestBuildCount
    Expect-Failure 'otra base de datos'
    Check ($global:deployTestBuildCount -eq $before) 'base externa bloqueada antes de construir o modificar Pagos'
    $global:deployTestHost = 'pagos-mysql'
    $global:deployTestVolume = $true
    $global:deployTestStoredPassword = 'otra-clave'
    Expect-Failure 'rotacion de credenciales'
    $global:deployTestStoredPassword = 'test-password'
    & (Join-Path $testRoot 'k8s/comun/deploy.ps1') -SinBuild *> $null
    Check ($global:deployTestBuildCount -eq $before) 'actualizacion con volumen conserva credenciales y permite SinBuild'
    [IO.File]::WriteAllText($testEnv, $envText.Replace('JWT_SECRET=0123456789abcdef0123456789abcdef', 'JWT_SECRET='))
    Expect-Failure 'JWT_SECRET'
    Write-Host 'Pruebas de instalacion aisladas aprobadas; sin servicios reales.'
} finally {
    Set-Location $originalLocation
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved).StartsWith('pagos-deploy-test-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
