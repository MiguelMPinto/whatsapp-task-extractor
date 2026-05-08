# Rotacao de logs:
#  - renomeia ficheiros >5MB para <base>.<yyyyMMdd-HHmmss>.log
#  - apaga ficheiros .log com mtime > 30 dias

$ErrorActionPreference = 'Continue'

$logsDir = Join-Path $PSScriptRoot '..\logs'
if (-not (Test-Path $logsDir)) {
    exit 0
}

$maxBytes = 5 * 1024 * 1024
$retentionDays = 30
$now = Get-Date

# Rotacao por tamanho — apenas ficheiros que ainda nao foram rotacionados
# (nome literal '<algo>.log', sem timestamp embutido).
Get-ChildItem -Path $logsDir -Filter '*.log' -File | ForEach-Object {
    if ($_.Length -gt $maxBytes -and $_.BaseName -notmatch '\.\d{8}-\d{6}$') {
        $stamp = $now.ToString('yyyyMMdd-HHmmss')
        $newName = "$($_.BaseName).$stamp.log"
        try {
            Rename-Item -LiteralPath $_.FullName -NewName $newName -Force
            Write-Output "rotacionado: $($_.Name) -> $newName"
        } catch {
            Write-Warning "falha a rotacionar $($_.Name): $_"
        }
    }
}

# Limpeza por idade
$cutoff = $now.AddDays(-$retentionDays)
Get-ChildItem -Path $logsDir -Filter '*.log' -File | Where-Object {
    $_.LastWriteTime -lt $cutoff
} | ForEach-Object {
    try {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Output "removido (>$retentionDays d): $($_.Name)"
    } catch {
        Write-Warning "falha a remover $($_.Name): $_"
    }
}

exit 0
