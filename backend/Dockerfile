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
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
# 容器内使用纯 HTTP 8080（HTTPS 在容器网络内不需要）
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "AiSchGeneratorApi.dll"]
