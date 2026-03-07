# scripts/stop-local.ps1
# 停止 AiSchGenerator 本地 Docker 开发环境
param(
    [switch]$RemoveVolumes  # 同时删除数据卷（⚠ 会清空数据库）
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if ($RemoveVolumes) {
    Write-Host "停止并删除所有容器和数据卷 (数据将丢失)..." -ForegroundColor Red
    docker compose down -v
} else {
    Write-Host "停止所有容器 (数据保留)..." -ForegroundColor Yellow
    docker compose down
}

Write-Host "已停止" -ForegroundColor Green
