# scripts/build-image.ps1
# 构建 AiSchGenerator API Docker 镜像
param(
    [string]$Version = "v0.2.0",                              # 版本号
    [string]$Tag = "gilzhang/verdure-aisch-api:$Version",    # 镜像标签
    [switch]$NoCache,                                         # 不使用构建缓存
    [switch]$Push                                             # 构建后推送到 Docker Hub
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# 版本号在 param 块里已插值，这里确保 Tag 含版本
if ($Tag -eq "gilzhang/verdure-aisch-api:$Version") {
    $Tag = "gilzhang/verdure-aisch-api:$Version"
}

$buildArgs = @("build", "-t", $Tag, "-f", "backend/Dockerfile", "backend")
if ($NoCache) { $buildArgs += "--no-cache" }

Write-Host "构建镜像: $Tag" -ForegroundColor Cyan
& docker @buildArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "镜像构建成功: $Tag" -ForegroundColor Green
    docker image inspect $Tag --format "大小: {{.Size}} bytes / 创建: {{.Created}}"
    if ($Push) {
        Write-Host "推送镜像到 Docker Hub: $Tag" -ForegroundColor Cyan
        docker push $Tag
        if ($LASTEXITCODE -eq 0) {
            Write-Host "推送成功: https://hub.docker.com/r/gilzhang/verdure-aisch-api" -ForegroundColor Green
        } else {
            Write-Host "推送失败，请先执行 docker login" -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "镜像构建失败" -ForegroundColor Red
    exit 1
}
