# Story 1.3: 配置 Docker Compose 本地开发环境

Status: review

## Story

As a 开发者,
I want 通过 `docker-compose up` 一键启动 PostgreSQL + Keycloak（+ 可选 Redis）开发环境,
so that 本地开发无需手动安装数据库和认证服务，团队成员可快速启动一致的环境。

## Acceptance Criteria

1. **Given** 已安装 Docker Desktop  
   **When** 执行 `docker-compose up -d`  
   **Then** PostgreSQL 容器在 `5432` 端口启动并健康，Keycloak 容器在 `8080` 端口启动并可访问管理界面（http://localhost:8080）

2. **Given** Docker Compose 配置  
   **When** 执行 `docker-compose --profile cache up -d`  
   **Then** Redis 容器额外在 `6379` 端口启动，基础服务（db、keycloak）不受影响

3. **Given** `.env.example` 文件  
   **When** 开发者复制为 `.env` 并填入真实值（或使用示例值）  
   **Then** Docker Compose 正确读取 `${OPENAI_ENDPOINT}` 和 `${OPENAI_API_KEY}` 等环境变量，服务正常启动

4. **Given** 后端服务使用 Docker Compose 提供的连接字符串配置  
   **When** 执行 `dotnet run`  
   **Then** 后端能成功连接 Docker Compose 中的 PostgreSQL，`GET /api/health` 返回 healthy

5. **Given** `docker-compose.yml` 中 `api` 服务配置  
   **When** 执行 `docker-compose up`（含 api 服务）  
   **Then** 后端容器使用 `./backend` 目录 Dockerfile 构建，通过 `5000:8080` 端口映射暴露服务

## Tasks / Subtasks

- [x] Task 1: 创建 `docker-compose.yml` (AC: 1, 2, 3, 5)
  - [x] 1.1 在项目根目录创建 `docker-compose.yml`，包含 4 个服务：`api`、`db`、`keycloak`、`redis`
  - [x] 1.2 配置 `db` 服务：`postgres:18-alpine3.22`，端口 `5432:5432`，环境变量 `POSTGRES_DB=aisch`、`POSTGRES_USER=dev`、`POSTGRES_PASSWORD=dev`，添加 healthcheck
  - [x] 1.3 配置 `keycloak` 服务：`quay.io/keycloak/keycloak:latest`，`command: start-dev`，端口 `8080:8080`，`KC_BOOTSTRAP_ADMIN_USERNAME=admin`/`KC_BOOTSTRAP_ADMIN_PASSWORD=admin`
  - [x] 1.4 配置 `redis` 服务：`redis:7.4-alpine3.21`，端口 `6379:6379`，`profiles: ["cache"]`（按需启动）
  - [x] 1.5 配置 `api` 服务：`build: ./backend`，端口 `5000:8080`，环境变量从 `${...}` 读取，`depends_on: [db, keycloak]`（使用 `condition: service_healthy`）

- [x] Task 2: 创建 `backend/Dockerfile` (AC: 5)
  - [x] 2.1 创建 `backend/Dockerfile`（多阶段构建：build stage + runtime stage）
  - [x] 2.2 Build 阶段：基于 `mcr.microsoft.com/dotnet/sdk:10.0`，复制 `.csproj`，还原包，复制源码，发布
  - [x] 2.3 Runtime 阶段：基于 `mcr.microsoft.com/dotnet/aspnet:10.0`，复制发布产物，`EXPOSE 8080`，设置 `ENTRYPOINT`
  - [x] 2.4 配置 runtime 阶段 `ASPNETCORE_URLS=http://+:8080`（容器内 HTTP，docker-compose 映射到宿主机 5000）

- [x] Task 3: 创建 `.env.example` 和 `.env` 配置 (AC: 3)
  - [x] 3.1 创建 `.env.example`，包含所有需要配置的变量占位：`OPENAI_ENDPOINT`、`OPENAI_API_KEY`、`OPENAI_MODEL_NAME`（附注释说明）
  - [x] 3.2 将 `.env` 添加到 `.gitignore`（防止真实密钥提交），`.env.example` 保持在版本控制中
  - [x] 3.3 验证 `.gitignore` 已包含 `.env`（不含 `.env.example`）

- [x] Task 4: 添加 `db` 服务健康检查并配置依赖 (AC: 1, 4)
  - [x] 4.1 为 `db` 服务添加 `healthcheck`：`pg_isready -U dev -d aisch`，`interval: 5s`，`retries: 5`
  - [x] 4.2 `api` 服务的 `depends_on.db` 改为 `condition: service_healthy`，确保 DB 就绪后再启动 API
  - [x] 4.3 `api` 服务的 `depends_on.keycloak` 使用 `condition: service_started`（Keycloak 冷启动较慢，不等待完全就绪）

- [x] Task 5: 验证 Docker Compose 环境 (AC: 1, 2, 3, 4)
  - [x] 5.1 执行 `docker-compose up -d db keycloak` 启动基础服务
  - [x] 5.2 验证 PostgreSQL：`docker-compose exec db psql -U dev -d aisch -c "\dt"` 确认连接正常
  - [x] 5.3 验证 Keycloak：在浏览器访问 http://localhost:8080，确认管理界面可访问
  - [x] 5.4 执行 `docker-compose --profile cache up -d redis` 验证 Redis 按需启动
  - [x] 5.5 执行 `dotnet run` 启动后端（不用 Docker api 服务），验证 `GET /api/health` 返回 healthy（连接 Docker Compose 的 PostgreSQL）

## Dev Notes

### 架构规范（MUST FOLLOW）

**来源：** [architecture.md#ADR-08：本地开发环境 — Docker Compose]

#### 完整 docker-compose.yml 规范（来自 ADR-08）

```yaml
# docker-compose.yml（开发环境）
services:
  api:
    build: ./backend
    ports: ["5000:8080"]
    environment:
      - ConnectionStrings__Default=Host=db;Database=aisch;Username=dev;Password=dev
      - Keycloak__Authority=http://keycloak:8080/realms/aisch
      - OpenAI__Endpoint=${OPENAI_ENDPOINT}
      - OpenAI__ApiKey=${OPENAI_API_KEY}
    depends_on: [db, keycloak]

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: aisch
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    ports: ["5432:5432"]

  keycloak:
    image: quay.io/keycloak/keycloak:26
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports: ["8080:8080"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    profiles: ["cache"]   # 按需启动：docker compose --profile cache up
```

> **注意：** ADR-08 中 `api` 服务的 `depends_on` 使用简写列表形式；实际实现应将 `db` 改为 `condition: service_healthy` 以确保 PostgreSQL 确实就绪，防止 API 连接失败。

#### ASP.NET Core 容器内环境变量规范

ASP.NET Core 配置系统支持通过 `__` 双下划线替代 `:` 来映射嵌套配置键：

| docker-compose 环境变量 | 对应 appsettings.json 路径 |
|------------------------|--------------------------|
| `ConnectionStrings__Default` | `ConnectionStrings.Default` |
| `Keycloak__Authority` | `Keycloak.Authority` |
| `OpenAI__Endpoint` | `OpenAI.Endpoint` |
| `OpenAI__ApiKey` | `OpenAI.ApiKey` |

这与 Story 1.2 中 `appsettings.json` 的配置节完全对应。

#### .NET 10 Docker 基础镜像

| 用途 | 镜像 |
|------|------|
| Build 阶段 | `mcr.microsoft.com/dotnet/sdk:10.0` |
| Runtime 阶段 | `mcr.microsoft.com/dotnet/aspnet:10.0` |

容器内默认端口：`8080`（非 HTTPS，符合 Story 1.2 中移除 `UseHttpsRedirection()` 的决策）

#### Keycloak 26 注意事项

- Keycloak 26 使用 `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` 设置初始管理员（旧版用 `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`）
- `command: start-dev` 启用开发模式（不需要 HTTPS、内嵌 H2 数据库可选 → 本项目连 PostgreSQL 在后续故事配置）
- Keycloak 首次启动较慢（30~60 秒），`api` 服务应使用 `condition: service_started` 而非 `service_healthy`

#### PostgreSQL healthcheck 示例

```yaml
healthcheck:
  test: ["CMD", "pg_isready", "-U", "dev", "-d", "aisch"]
  interval: 5s
  timeout: 5s
  retries: 5
  start_period: 10s
```

#### Dockerfile 多阶段构建示例

```dockerfile
# ===== Build Stage =====
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY AiSchGeneratorApi/AiSchGeneratorApi.csproj AiSchGeneratorApi/
RUN dotnet restore AiSchGeneratorApi/AiSchGeneratorApi.csproj
COPY . .
RUN dotnet publish AiSchGeneratorApi/AiSchGeneratorApi.csproj -c Release -o /app/publish

# ===== Runtime Stage =====
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "AiSchGeneratorApi.dll"]
```

### Story 1.2 遗留上下文（重要）

从 Story 1.2 学到的关键信息（**必须遵守**）：

- **项目路径**：`.csproj` 位于 `backend/AiSchGeneratorApi/AiSchGeneratorApi.csproj`，不是 `backend/`
- **Dockerfile 路径**：`docker-compose.yml` 中 `build: ./backend`，Dockerfile 需放在 `backend/Dockerfile`（Docker build context 为 `./backend` 目录）
- **移除 HTTPS**：`Program.cs` 已移除 `UseHttpsRedirection()`，容器内使用纯 HTTP `8080` 端口，无需 HTTPS 证书
- **appsettings.json 配置节**：`ConnectionStrings.Default`、`Keycloak.Authority`、`OpenAI.Endpoint`、`OpenAI.ApiKey` 均已在 Story 1.2 配置，docker-compose 环境变量使用 `__` 双下划线覆盖这些值
- **本地直接运行（不用 Docker API）**：开发时推荐 `docker-compose up -d db keycloak` + `dotnet run`，比 docker-compose 构建 api 容器快

### 文件结构（本故事创建/修改的文件）

```
lceda-ai/
├── docker-compose.yml          ← 新建（项目根目录）
├── .env.example                ← 新建（项目根目录）
├── .gitignore                  ← 修改（添加 .env）
└── backend/
    └── Dockerfile              ← 新建
```

### 安全注意事项

- `.env` 文件包含真实 API Key，**必须** 在 `.gitignore` 中排除
- `docker-compose.yml` 中 `db` 服务密码使用固定的 `dev`/`dev`，这是**仅限本地开发**的配置，生产环境需通过 secrets 管理
- Keycloak admin 密码 `admin`/`admin` 同样仅限本地开发使用

### 本故事不涉及的内容（禁止超范围实现）

- ❌ Keycloak Realm/Client 配置（Story 2.x 范围：创建 `aisch` Realm、配置 PKCE Client）
- ❌ EF Core 数据库迁移（Story 1.4 范围）
- ❌ 连接 Keycloak PostgreSQL 数据库（可选：Keycloak start-dev 使用内嵌 H2，本故事不配置外部 PostgreSQL 给 Keycloak）
- ❌ Redis 集成到应用层（Post-MVP 范围）
- ❌ 生产环境 Docker 配置（POC 范围外）
- ❌ CI/CD 流水线（POC 范围外）

### References

- [Source: architecture.md#ADR-08：本地开发环境 — Docker Compose]
- [Source: architecture.md#ADR-04：数据存储 — PostgreSQL + Redis]
- [Source: architecture.md#ADR-05：认证方案 — Keycloak OIDC Authorization Code Flow]
- [Source: epics.md#Story 1.3: 配置 Docker Compose 本地开发环境]
- [Source: 1-2-aspnetcore-backend-scaffold.md#Dev Agent Record（Story 1.2 遗留上下文）]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

- 镜像版本调整：`quay.io/keycloak/keycloak:26` tag 不存在，改用参考项目版本（postgres:18-alpine3.22 本地缓存，redis:7.4-alpine3.21 本地缓存，keycloak:latest 从网络拉取）

### Completion Notes List

- ✅ 创建 `docker-compose.yml`（项目根目录），含 4 服务：api/db/keycloak/redis
- ✅ `db` 服务使用 `postgres:18-alpine3.22`（本地镜像缓存），healthcheck pg_isready
- ✅ `keycloak` 服务使用 `quay.io/keycloak/keycloak:latest`（KC_BOOTSTRAP_ADMIN_* 新式环境变量）
- ✅ `redis` 服务使用 `redis:7.4-alpine3.21`（本地镜像缓存），`profiles: [cache]` 按需启动
- ✅ `api` 服务 `depends_on.db condition: service_healthy`，`depends_on.keycloak condition: service_started`
- ✅ 创建 `backend/Dockerfile`（多阶段构建，sdk:10.0 build → aspnet:10.0 runtime，EXPOSE 8080，ASPNETCORE_URLS=http://+:8080）
- ✅ 创建 `.env.example`（OPENAI_ENDPOINT/OPENAI_API_KEY/OPENAI_MODEL_NAME 占位）
- ✅ `.gitignore` 已有 `*.env` + 新增显式 `.env` 条目
- ✅ 验证：db healthy，keycloak up，redis up（profile cache），`GET /api/health` → `{success:true,data:healthy}`

### File List

- docker-compose.yml (新建)
- backend/Dockerfile (新建)
- .env.example (新建)
- .gitignore (修改 - 添加 .env 显式条目)
