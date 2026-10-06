param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$phpExecutable = $env:PHP_EXECUTABLE
if (-not $phpExecutable) {
    $phpCommand = Get-Command php -ErrorAction SilentlyContinue
    $phpExecutable = if ($phpCommand) { $phpCommand.Source } else { 'C:\xampp\php\php.exe' }
}
if (-not (Test-Path -LiteralPath $phpExecutable)) { throw 'Configura PHP_EXECUTABLE o instala PHP en PATH' }
$hasSockets = & $phpExecutable -r 'echo extension_loaded("sockets") ? "1" : "0";'
$phpOptions = if ($hasSockets -eq '1') { @() } else { @('-d', 'extension=sockets') }
& $phpExecutable @phpOptions (Join-Path $PSScriptRoot 'bin\console.php') @Arguments
exit $LASTEXITCODE
