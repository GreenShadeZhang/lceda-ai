# scripts/view-logs.ps1
# 查看 AiSchGenerator Docker 服务日志
param(
    [string]$Service = "",      # 指定服务名: api | db | keycloak（空 = 全部）
    [int]$Tail = 100,           # 显示最近 N 行
    [switch]$Follow             # 持续跟随日志输出
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$logArgs = @("compose", "logs")
if ($Follow) { $logArgs += "--follow" }
$logArgs += "--tail=$Tail"
if ($Service) { $logArgs += $Service }

& docker @logArgs
