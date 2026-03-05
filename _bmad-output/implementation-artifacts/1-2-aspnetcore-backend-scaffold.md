# Story 1.2: 搭建后端 ASP.NET Core 项目结构

Status: review

## Story

As a 开发者,
I want 搭建符合架构规范的 ASP.NET Core (.NET 10) 后端项目（Clean Architecture 分层）,
so that 后端能启动并通过健康检查接口验证基础配置正确。

## Acceptance Criteria

1. **Given** 已安装 .NET 10 SDK  
   **When** 在 `backend/` 目录执行 `dotnet run`  
   **Then** 服务在配置端口启动，`GET /api/health` 返回 `{"success": true, "data": "healthy"}`

2. **Given** 后端项目结构  
   **When** 审查目录  
   **Then** 包含 `Api/`、`Services/`、`Agents/`、`Tools/`、`Infrastructure/`、`Models/`、`Contracts/` 分层目录，符合 ADR-01 架构规范

3. **Given** `Contracts/ApiResponse.cs` 统一响应 Wrapper  
   **When** 调用 `GET /api/health`  
   **Then** 响应格式为 `{"success": true, "data": "healthy"}`，使用 `ApiResponse<T>` 泛型包装器

4. **Given** `appsettings.json` 配置  
   **When** 项目执行 `dotnet run` 启动  
   **Then** 包含 `Keycloak:Authority`、`OpenAI:Endpoint`、`OpenAI:ApiKey`、`ConnectionStrings:Default` 占位配置项，项目无启动异常

## Tasks / Subtasks

- [x] Task 1: 初始化 backend/ 项目结构 (AC: 1, 2)
  - [x] 1.1 在项目根目录创建 `backend/` 子目录
  - [x] 1.2 在 `backend/` 目录执行 `dotnet new webapi -n AiSchGeneratorApi --use-controllers --no-openapi`（.NET 10，不含 OpenAPI 以保持简洁）
  - [x] 1.3 在 `backend/AiSchGeneratorApi/` 下创建 Clean Architecture 分层目录：`Api/Controllers/`、`Services/`、`Agents/`、`Tools/`、`Infrastructure/Data/`、`Models/`、`Contracts/`
  - [x] 1.4 删除模板生成的 `WeatherForecast.cs`、`WeatherForecastController.cs`（清理无用代码）
  - [x] 1.5 在 `backend/` 目录的 `.gitignore` 配置中添加 `bin/` 和 `obj/` 排除项（更新根目录 `.gitignore`）

- [x] Task 2: 创建 ApiResponse 统一响应 Wrapper (AC: 3)
  - [x] 2.1 创建 `backend/AiSchGeneratorApi/Contracts/ApiResponse.cs`，定义泛型 `ApiResponse<T>` 类（含 `Success`、`Data`、`Error` 字段）
  - [x] 2.2 创建 `backend/AiSchGeneratorApi/Contracts/ApiError.cs`，定义 `ApiError` 类（含 `Code`、`Message`、`Details` 字段）
  - [x] 2.3 在 `ApiResponse<T>` 中添加静态工厂方法：`Ok(T data)` 返回成功响应，`Fail(string code, string message)` 返回失败响应
  - [x] 2.4 确认 JSON 序列化为 camelCase（需在 Program.cs 配置 `JsonNamingPolicy.CamelCase` 或使用 `[JsonPropertyName]` 特性）

- [x] Task 3: 实现 HealthController (AC: 1, 3)
  - [x] 3.1 创建 `backend/AiSchGeneratorApi/Api/Controllers/HealthController.cs`
  - [x] 3.2 实现 `GET /api/health` 端点，返回 `ApiResponse<string>.Ok("healthy")`
  - [x] 3.3 健康检查端点不需要认证（`[AllowAnonymous]` 或不添加 `[Authorize]`）
  - [x] 3.4 使用 `[Route("api/[controller]")]` 路由特性，端点路径为 `/api/health`

- [x] Task 4: 配置 appsettings.json (AC: 4)
  - [x] 4.1 更新 `appsettings.json`，添加 `Keycloak`、`OpenAI`、`ConnectionStrings` 配置节
  - [x] 4.2 创建 `appsettings.Development.json` 包含本地开发占位值（不含真实密钥）
  - [x] 4.3 将 `appsettings.Development.json` 中的敏感字段（`OpenAI:ApiKey`）设为空字符串占位，留注释说明需配置

- [x] Task 5: 配置 Program.cs (AC: 1, 4)
  - [x] 5.1 配置控制器（`builder.Services.AddControllers()`），设置 JSON 为 camelCase（`options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase`）
  - [x] 5.2 移除默认模板的 Swagger / OpenAPI 配置（POC 阶段不需要）
  - [x] 5.3 添加 CORS 配置（开发环境允许跨域，为 IFrame 请求预留）
  - [x] 5.4 注册 `app.MapControllers()` 路由映射

- [x] Task 6: 安装 NuGet 依赖包 (AC: 1)
  - [x] 6.1 安装 `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.0（EF Core PostgreSQL 驱动，Story 1.4 使用）
  - [x] 6.2 安装 `EFCore.NamingConventions` 10.0.1（snake_case 命名约定，Story 1.4 使用）
  - [x] 6.3 安装 `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.3（JWT 验证，Story 2.3 使用）
  - [x] 6.4 安装 `Azure.AI.OpenAI` 2.1.0（OpenAI 兼容 SDK，Story 3.2 使用）
  - [x] 6.5 仅安装依赖，**不实现**对应功能（这些包由后续故事使用，本故事只需确保 `dotnet build` 通过）

- [x] Task 7: 验证项目启动 (AC: 1)
  - [x] 7.1 在 `backend/AiSchGeneratorApi/` 执行 `dotnet build` 确认无编译错误
  - [x] 7.2 执行 `dotnet run`，确认服务在 `http://localhost:5000` 启动
  - [x] 7.3 使用 PowerShell `Invoke-RestMethod` 验证返回 `{"success":true,"data":"healthy"}`

## Dev Notes

### 架构规范（MUST FOLLOW）

**来源：** [architecture.md](../planning-artifacts/architecture.md)

#### 项目目录结构（backend/ 范围）

```
lceda-ai/                              ← 项目根目录
├── plugin/                            ← Story 1.1 已完成
├── backend/
│   └── AiSchGeneratorApi/             ← ASP.NET Core Web API 项目
│       ├── Api/
│       │   └── Controllers/
│       │       ├── HealthController.cs       ← 本故事实现
│       │       └── SchematicsController.cs   ← Story 3.2 实现（占位目录）
│       ├── Services/                          ← Story 3.2 实现（占位目录）
│       ├── Agents/                            ← Story 3.2 实现 Agent（占位目录）
│       ├── Tools/                             ← Story 3.2 实现 Tools（占位目录）
│       ├── Infrastructure/
│       │   └── Data/
│       │       └── AppDbContext.cs            ← Story 1.4 实现（占位目录）
│       ├── Models/                            ← Story 1.4 实现（占位目录）
│       ├── Contracts/
│       │   ├── ApiResponse.cs                ← 本故事实现
│       │   └── ApiError.cs                   ← 本故事实现
│       ├── Program.cs                         ← 本故事配置
│       ├── appsettings.json                   ← 本故事配置
│       ├── appsettings.Development.json       ← 本故事创建
│       └── AiSchGeneratorApi.csproj           ← .NET 10 项目文件
└── docker-compose.yml                         ← Story 1.3 实现
```

#### ApiResponse 完整规范

**来源：** [architecture.md#API 响应格式统一包装]

```csharp
// backend/AiSchGeneratorApi/Contracts/ApiResponse.cs
namespace AiSchGeneratorApi.Contracts;

public class ApiResponse<T>
{
    public bool Success { get; init; }
    public T? Data { get; init; }
    public ApiError? Error { get; init; }

    public static ApiResponse<T> Ok(T data) =>
        new() { Success = true, Data = data };

    public static ApiResponse<T> Fail(string code, string message, object? details = null) =>
        new() { Success = false, Error = new ApiError(code, message, details) };
}
```

```csharp
// backend/AiSchGeneratorApi/Contracts/ApiError.cs
namespace AiSchGeneratorApi.Contracts;

public record ApiError(string Code, string Message, object? Details = null);
```

**JSON 序列化输出（必须为 camelCase）：**
```json
// 成功
{ "success": true, "data": "healthy" }

// 失败
{
  "success": false,
  "error": {
    "code": "COMPONENT_NOT_FOUND",
    "message": "未找到匹配的立创官方库元件",
    "details": null
  }
}
```

#### HealthController 规范

```csharp
// backend/AiSchGeneratorApi/Api/Controllers/HealthController.cs
using Microsoft.AspNetCore.Mvc;
using AiSchGeneratorApi.Contracts;

namespace AiSchGeneratorApi.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(ApiResponse<string>.Ok("healthy"));
    }
}
```

#### appsettings.json 完整模板

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "Default": "Host=localhost;Database=aisch;Username=dev;Password=dev"
  },
  "Keycloak": {
    "Authority": "http://localhost:8080/realms/aisch",
    "Audience": "ai-sch-backend"
  },
  "OpenAI": {
    "Endpoint": "https://api.openai.com/v1",
    "ApiKey": "",
    "ModelName": "gpt-4o"
  }
}
```

> **注意：** `OpenAI:ApiKey` 留空占位，需开发者在 `appsettings.Development.json` 或用户密钥（user secrets）中填入真实值。**不得**将真实 API key 提交到 git。

#### Program.cs 最小配置模板

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

// Controllers with camelCase JSON serialization
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.DefaultIgnoreCondition = 
            JsonIgnoreCondition.WhenWritingNull;
    });

// Development CORS (for IFrame requests)
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCors(options =>
    {
        options.AddDefaultPolicy(policy =>
            policy.AllowAnyOrigin()
                  .AllowAnyMethod()
                  .AllowAnyHeader());
    });
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseCors();
}

app.UseHttpsRedirection();  // Comment out if not using HTTPS in dev
app.MapControllers();

app.Run();
```

#### C# 命名规范（来自 architecture.md）

| 元素 | 规范 | 示例 |
|------|------|------|
| 类、接口、方法 | PascalCase | `SchematicService`, `GenerateAsync()` |
| 属性、参数 | PascalCase（属性）/ camelCase（参数） | `public string UserId` / `string userId` |
| 私有字段 | `_camelCase` | `private readonly ILogger _logger` |
| 常量 | PascalCase | `MaxRetryCount` |
| 文件名 | 与类名一致，一文件一类 | `HealthController.cs` |
| 命名空间 | `AiSchGeneratorApi.{Layer}` | `AiSchGeneratorApi.Contracts` |

#### .NET 10 版本与包版本说明

- 目标框架：`net10.0`（`<TargetFramework>net10.0</TargetFramework>`）
- 默认端口（开发环境 `launchSettings.json`）：HTTP `5000`，HTTPS `5001`
- NuGet 包安装（在 `backend/AiSchGeneratorApi/` 目录执行）：

```bash
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL
dotnet add package EFCore.NamingConventions
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
dotnet add package Azure.AI.OpenAI
```

> **注意：** `Microsoft Agent Framework .NET` 是独立 NuGet 包，在 Story 3 实现 Agent 时再安装，**本故事不安装**，避免引入未使用的大型依赖。

#### Story 1.1 遗留上下文

从上一个故事（Story 1.1 — EDA 插件骨架）学到：

- 项目根目录 `.gitignore` 需要更新，本故事需添加 `backend/**/bin/` 和 `backend/**/obj/` 排除项
- `plugin/` 目录已存在，`backend/` 为并列目录（monorepo 结构）
- Node.js 工具已就绪（ESBuild），后端使用完全独立的 .NET 构建链
- 构建产物验证方法：和 Story 1.1 核实 `.eext` 一样，验证 `dotnet run` 响应

#### 标准错误码（供参考，本故事不需实现）

来自 `architecture.md`:

| 错误码 | 场景 |
|--------|------|
| `COMPONENT_NOT_FOUND` | 立创库中无匹配元件 |
| `LLM_PARSE_ERROR` | LLM 返回无效 JSON |
| `AUTH_REQUIRED` | Token 缺失或过期 |
| `INVALID_REQUEST` | 请求参数校验失败 |
| `INTERNAL_ERROR` | 后端未预期异常 |

### 本故事不涉及的内容（禁止超范围实现）

- ❌ Keycloak JWT 验证中间件（Story 2.3 范围）
- ❌ EF Core DbContext 实现和迁移（Story 1.4 范围）
- ❌ Docker Compose 配置（Story 1.3 范围）
- ❌ Microsoft Agent Framework 集成（Story 3.2 范围）
- ❌ `/api/schematics/generate` 端点实现（Story 3.2 范围）
- ❌ Redis 缓存配置（Post-MVP 范围）
- ❌ HTTPS 证书配置（POC 阶段使用 HTTP 即可）
- ❌ Swagger / OpenAPI 文档（POC 阶段不需要）

### Project Structure Notes

- `backend/AiSchGeneratorApi/` 为 .NET 项目根（`.csproj` 所在目录），`dotnet run` 在此执行
- `Api/Controllers/` 遵循 Clean Architecture 的 Presentation Layer，控制器仅做请求/响应转换，不含业务逻辑
- `Services/`、`Agents/`、`Tools/`、`Infrastructure/` 目录本故事仅创建空目录（放置 `.gitkeep`），为后续故事占位
- `.gitignore` 须排除 `backend/**/bin/` 和 `backend/**/obj/`（.NET 构建输出，体积大）
- `appsettings.Development.json` 中 `OpenAI:ApiKey` 留空，真实值通过 `dotnet user-secrets` 或环境变量注入

### References

- [Source: architecture.md#ADR-01：后端服务语言 — .NET (ASP.NET Core)]
- [Source: architecture.md#ADR-06：API 设计 — REST + SSE 流式输出]
- [Source: architecture.md#ADR-07：数据库访问层 — EF Core + Npgsql]
- [Source: architecture.md#API 响应格式统一包装]
- [Source: architecture.md#后端 C#（ASP.NET Core）命名规范]
- [Source: architecture.md#完整技术栈总览]
- [Source: epics.md#Story 1.2: 搭建后端 ASP.NET Core 项目结构]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (GitHub Copilot)

### Debug Log References

- NuGet 安装输出：所有 4 个包安装成功，安装日志写入临时文件确认
- dotnet build：0 Error(s)，构建耗时约 13 秒
- Invoke-RestMethod http://localhost:5000/api/health：返回 `{ success: True, data: healthy }`

### Completion Notes List

- 已删除 `Controllers/WeatherForecastController.cs` 和 `WeatherForecast.cs` 模板文件
- HealthController 放置在 `Api/Controllers/` 路径，命名空间 `AiSchGeneratorApi.Api.Controllers`
- 移除了 `UseHttpsRedirection()`，开发阶段使用纯 HTTP
- `Microsoft.AspNetCore.Authentication.JwtBearer` 解析为版本 10.0.3（非 8.x），与 .NET 10 项目目标框架匹配
- `Azure.AI.OpenAI` 解析为版本 2.1.0

### File List

- backend/AiSchGeneratorApi/AiSchGeneratorApi.csproj（已更新 NuGet 包引用）
- backend/AiSchGeneratorApi/Program.cs（已更新：camelCase JSON + CORS + MapControllers）
- backend/AiSchGeneratorApi/appsettings.json（已更新：Keycloak/OpenAI/ConnectionStrings）
- backend/AiSchGeneratorApi/appsettings.Development.json（已更新：OpenAI:ApiKey 空占位）
- backend/AiSchGeneratorApi/Contracts/ApiResponse.cs（新建）
- backend/AiSchGeneratorApi/Contracts/ApiError.cs（新建）
- backend/AiSchGeneratorApi/Api/Controllers/HealthController.cs（新建）
- backend/AiSchGeneratorApi/Services/.gitkeep（新建，占位）
- backend/AiSchGeneratorApi/Agents/.gitkeep（新建，占位）
- backend/AiSchGeneratorApi/Tools/.gitkeep（新建，占位）
- backend/AiSchGeneratorApi/Infrastructure/Data/.gitkeep（新建，占位）
- backend/AiSchGeneratorApi/Models/.gitkeep（新建，占位）
- .gitignore（已更新：添加 backend/**/bin/ 和 backend/**/obj/）
