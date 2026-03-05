# Story 1.4: EF Core 初始数据库迁移与连接验证

Status: review

## Story

As a 开发者,
I want 执行 EF Core Code-First 初始迁移创建基础数据库结构,
So that 数据库 `schematic_histories` 表存在并符合 snake_case 命名规范，后端可正常读写。

## Acceptance Criteria

1. **Given** Docker Compose PostgreSQL 服务已启动  
   **When** 执行 `dotnet ef migrations add InitialCreate && dotnet ef database update`  
   **Then** 迁移成功执行，数据库中出现 `schematic_histories` 表，列名为 `snake_case`（如 `user_id`、`created_at`、`circuit_json`）

2. **Given** `AppDbContext.cs` 配置了 `UseSnakeCaseNamingConvention()`  
   **When** 检查数据库表结构  
   **Then** 所有列名为 `snake_case`，表名为复数 `snake_case`，符合 ADR-07 规范

3. **Given** 后端启动时  
   **When** 应用启动  
   **Then** EF Core 能成功连接 PostgreSQL，无连接异常日志

## Tasks / Subtasks

- [x] Task 1: 创建 `SchematicHistory.cs` 实体 (AC: 1, 2)
  - [x] 1.1 在 `backend/AiSchGeneratorApi/Models/` 创建 `SchematicHistory.cs`
  - [x] 1.2 包含属性：`Id`(Guid)、`UserId`(string)、`UserInput`(string)、`CircuitJson`(string)、`CreatedAt`(DateTime)、`IsSuccess`(bool)

- [x] Task 2: 创建 `AppDbContext.cs` (AC: 2)
  - [x] 2.1 在 `backend/AiSchGeneratorApi/Infrastructure/Data/` 创建 `AppDbContext.cs`
  - [x] 2.2 继承 `DbContext`，添加 `DbSet<SchematicHistory> SchematicHistories`
  - [x] 2.3 `UseSnakeCaseNamingConvention()` 在 `DbContextOptionsBuilder` 上配置（正确用法，非 ModelBuilder）

- [x] Task 3: 注册 DbContext 到 DI 容器 (AC: 3)
  - [x] 3.1 在 `Program.cs` 中使用 `AddDbContext<AppDbContext>` 注册，连接字符串读取 `ConnectionStrings:Default`
  - [x] 3.2 使用 `UseNpgsql()` 驱动，并链式调用 `UseSnakeCaseNamingConvention()`

- [x] Task 4: 执行 EF Core 迁移 (AC: 1)
  - [x] 4.1 确认 `dotnet-ef` 工具可用（6.0.8，可用）
  - [x] 4.2 执行 `dotnet ef migrations add InitialCreate`（生成迁移文件）
  - [x] 4.3 执行 `dotnet ef database update`（所有列 snake_case，表创建成功）

- [x] Task 5: 验证数据库结构 (AC: 1, 2, 3)
  - [x] 5.1 `\dt` 确认 `schematic_histories` 表存在 ✅
  - [x] 5.2 列名：`id`, `user_id`, `user_input`, `circuit_json`, `created_at`, `is_success` — 全部 snake_case ✅
  - [x] 5.3 `GET /api/health` → `{success:true,data:healthy}`，无连接异常 ✅

## Dev Notes

### 架构规范（来自 ADR-07）

**数据模型：**
```csharp
public class SchematicHistory
{
    public Guid Id { get; set; }
    public string UserId { get; set; }        // 来自 Keycloak sub claim
    public string UserInput { get; set; }     // 原始自然语言需求
    public JsonDocument CircuitJson { get; set; } // 生成的电路 JSON（JSONB）
    public DateTime CreatedAt { get; set; }
    public bool IsSuccess { get; set; }
}
```

**命名规范（ADR-07）：**
| 目标 | 规范 | 示例 |
|------|------|------|
| 表名 | `snake_case` 复数 | `schematic_histories` |
| 列名 | `snake_case` | `user_id`, `created_at`, `circuit_json` |

使用 `UseSnakeCaseNamingConvention()`（EFCore.NamingConventions 包，已安装）自动处理 PascalCase → snake_case。

**AppDbContext 注册方式（Program.cs）：**
```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
           .UseSnakeCaseNamingConvention());
```

**注意事项：**
- `CircuitJson` 暂时用 `string` 类型（后续 Story 可改为 JSONB）；使用 `JsonDocument` 需要特殊配置
- `CreatedAt` 使用 `DateTime`，EF Core 会自动映射为 `timestamp without time zone`
- `dotnet ef` 工具需要在项目目录下执行
- Docker Compose db 服务需保持运行状态（`docker compose up -d db`）

**文件位置：**
```
backend/AiSchGeneratorApi/
├── Models/
│   └── SchematicHistory.cs     ← 新建
├── Infrastructure/
│   └── Data/
│       ├── AppDbContext.cs      ← 新建（替换 .gitkeep）
│       └── Migrations/         ← dotnet ef 自动生成
```

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

- `UseSnakeCaseNamingConvention()` 是 `DbContextOptionsBuilder` 扩展方法，不能在 `OnModelCreating(ModelBuilder)` 中调用，已修正
- `dotnet-ef` 6.0.8 版本与运行时 10.0.3 有版本差异警告（不影响功能，后续可升级）
- 安装了 `Microsoft.EntityFrameworkCore.Design` 10.0.3（dotnet ef 工具所必需）

### Completion Notes List

- ✅ 创建 `Models/SchematicHistory.cs`（Guid Id, string UserId/UserInput/CircuitJson, DateTime CreatedAt, bool IsSuccess）
- ✅ 创建 `Infrastructure/Data/AppDbContext.cs`（DbSet<SchematicHistory>，无需 OnModelCreating）
- ✅ `Program.cs` 注册 `AddDbContext<AppDbContext>` + `UseNpgsql` + `UseSnakeCaseNamingConvention()`
- ✅ `dotnet ef migrations add InitialCreate` 生成迁移文件
- ✅ `dotnet ef database update` 应用迁移，表 `schematic_histories` 所有列 snake_case
- ✅ 后端启动正常，`GET /api/health` 返回 healthy

### File List

- backend/AiSchGeneratorApi/Models/SchematicHistory.cs (新建)
- backend/AiSchGeneratorApi/Infrastructure/Data/AppDbContext.cs (新建，替换 .gitkeep)
- backend/AiSchGeneratorApi/Program.cs (修改 - 添加 DbContext 注册)
- backend/AiSchGeneratorApi/AiSchGeneratorApi.csproj (修改 - 添加 EFCore.Design 包)
- backend/AiSchGeneratorApi/Migrations/20260305152318_InitialCreate.cs (自动生成)
- backend/AiSchGeneratorApi/Migrations/20260305152318_InitialCreate.Designer.cs (自动生成)
- backend/AiSchGeneratorApi/Migrations/AppDbContextModelSnapshot.cs (自动生成)
