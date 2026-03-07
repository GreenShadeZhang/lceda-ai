# scripts/build-image.ps1
# 构建 AiSchGenerator API Docker 镜像
param(
    [string]$Tag = "aisch-api:local",  # 镜像标签
    [switch]$NoCache                    # 不使用构建缓存
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$buildArgs = @("build", "-t", $Tag, "-f", "backend/Dockerfile", "backend")
if ($NoCache) { $buildArgs += "--no-cache" }

Write-Host "构建镜像: $Tag" -ForegroundColor Cyan
& docker @buildArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "镜像构建成功: $Tag" -ForegroundColor Green
    docker image inspect $Tag --format "大小: {{.Size}} bytes / 创建: {{.Created}}"
} else {
    Write-Host "镜像构建失败" -ForegroundColor Red
    exit 1
}
