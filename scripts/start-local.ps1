# scripts/start-local.ps1
# 启动 AiSchGenerator 本地 Docker 开发环境
param(
    [switch]$Build  # 强制重新构建 API 镜像
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

Write-Host "AiSchGenerator - 启动本地环境" -ForegroundColor Cyan

# 检查 .env 文件
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "未找到 .env，从 .env.example 创建..." -ForegroundColor Yellow
    Copy-Item (Join-Path $root ".env.example") $envFile
    Write-Host "请编辑 $envFile 填写 OPENAI_API_KEY 后重新运行" -ForegroundColor Red
    exit 1
}

Set-Location $root

if ($Build) {
    Write-Host "构建 API 镜像..." -ForegroundColor Yellow
    docker compose build api
}

Write-Host "启动所有服务..." -ForegroundColor Green
docker compose up -d

Write-Host ""
Write-Host "服务地址：" -ForegroundColor Cyan
Write-Host "  API         : http://localhost:5000"
Write-Host "  Keycloak    : http://localhost:8080  (admin / admin)"
Write-Host "  PostgreSQL  : localhost:5432  (dev / dev)"
Write-Host ""
Write-Host "查看日志: .\scripts\view-logs.ps1" -ForegroundColor DarkGray
Write-Host "停止服务: .\scripts\stop-local.ps1"  -ForegroundColor DarkGray
