# scripts/health-check.ps1
# 检查 AiSchGenerator 各服务健康状态
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "=== AiSchGenerator 服务健康检查 ===" -ForegroundColor Cyan

# API 健康检查
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:5267/healthz" -UseBasicParsing -TimeoutSec 5
    $body = $resp.Content | ConvertFrom-Json
    Write-Host "API          : HEALTHY ($($body.status))" -ForegroundColor Green
} catch {
    Write-Host "API          : UNHEALTHY — $($_.Exception.Message)" -ForegroundColor Red
}

# PostgreSQL 健康检查（通过 docker exec）
$pgReady = docker compose exec -T db pg_isready -U dev -d aisch 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "PostgreSQL   : HEALTHY" -ForegroundColor Green
} else {
    Write-Host "PostgreSQL   : UNHEALTHY — $pgReady" -ForegroundColor Red
}

# Keycloak 健康检查
try {
    $kc = Invoke-WebRequest -Uri "http://localhost:8080/health/ready" -UseBasicParsing -TimeoutSec 5
    Write-Host "Keycloak     : HEALTHY (HTTP $($kc.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "Keycloak     : STARTING or UNHEALTHY" -ForegroundColor Yellow
}

# 容器状态汇总
Write-Host ""
Write-Host "容器状态：" -ForegroundColor Cyan
docker compose ps
