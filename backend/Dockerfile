# ===== Build Stage =====
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# 先复制 .csproj 利用 Docker 层缓存（依赖未变时跳过 restore）
COPY AiSchGeneratorApi/AiSchGeneratorApi.csproj AiSchGeneratorApi/
RUN dotnet restore AiSchGeneratorApi/AiSchGeneratorApi.csproj
# 复制全部源码并发布
COPY . .
RUN dotnet publish AiSchGeneratorApi/AiSchGeneratorApi.csproj -c Release -o /app/publish --no-restore

# ===== Runtime Stage =====
# 使用 Alpine 变体减小镜像体积（从 ~230MB 降至 ~100MB）
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
# 容器内使用纯 HTTP 8080（HTTPS 在容器网络内不需要）
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
# Docker 健康检查：调用 /healthz 端点
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O- http://localhost:8080/healthz || exit 1
ENTRYPOINT ["dotnet", "AiSchGeneratorApi.dll"]
